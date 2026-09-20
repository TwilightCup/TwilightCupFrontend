"""Read-only contract test against a local backend checkout.

Run from the frontend root:
  ../TwilightCupBackend/.venv/bin/python -B tests/integration/console_stage.py ../TwilightCupBackend

Real frontend stores, clocks and lease reports drive the real backend dispatcher.
WebSocket transport and media decoding are simulated; no database/server is started.
"""

import json
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace
import unittest

sys.dont_write_bytecode = True
backend = Path(sys.argv.pop(1)).resolve()
sys.path.insert(0, str(backend / "src"))

from twilightcupbackend import connection_manager as module
from twilightcupbackend.config import settings
from twilightcupbackend.connection_manager import ConnectionManager
from twilightcupbackend.datatypes import MatchStatus, Seat
from twilightcupbackend.protocol import ClientDirectorCommand
from twilightcupbackend.stores import Connection, MatchRegistry


class ConsoleStageContract(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.now = 0
        self.saved_clocks = module._now_ms, module._align_now_ms
        module._now_ms = lambda: 1760000000000 + self.now
        module._align_now_ms = lambda: 100000 + self.now
        self.cm = ConnectionManager(None, MatchRegistry(), settings)
        self.cm.match_engine = object()  # Clock commands never access the match engine.
        self.store = self.cm.registry.get_or_create(SimpleNamespace(id="match", status=MatchStatus.RUNNING))
        self.connections, self.kinds, self.incoming = {}, {}, []
        self.latency = {}
        self.frame_senders = []
        self.bridge = subprocess.Popen(
            ["node", "tests/helpers/director-page.cjs"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True,
        )

    async def asyncTearDown(self):
        self.bridge.stdin.close()
        self.bridge.wait(timeout=10)
        self.bridge.stdout.close()
        module._now_ms, module._align_now_ms = self.saved_clocks

    @property
    def state(self):
        return self.cm._director_state[("account", "match")]

    def request(self, **command):
        self.bridge.stdin.write(json.dumps(command) + "\n")
        self.bridge.stdin.flush()
        result = json.loads(self.bridge.stdout.readline())
        self.assertNotIn("error", result, result.get("error"))
        self.snapshots = result["snapshots"]
        return result["out"]

    async def pump(self, outgoing=()):
        pending = list(outgoing)
        for _ in range(100):
            for entry in pending:
                message = entry["message"]
                if message["action"] == "frame_align":
                    self.frame_senders.append(entry["id"])
                    self.assertEqual(self.kinds[entry["id"]], "console")
                await self.cm._dispatch(self.connections[entry["id"]], ClientDirectorCommand.model_validate(message))
            await self.cm._flush_align_notifications()
            pending = []
            incoming = [item for item in self.incoming if item[0] <= self.now]
            self.incoming = [item for item in self.incoming if item[0] > self.now]
            for _, page_id, message in incoming:
                self.assertNotEqual(message["type"], "error", message)
                if page_id in self.connections:
                    pending.extend(self.request(op="deliver", id=page_id, message=message, now=self.now))
            if not pending and not any(item[0] <= self.now for item in self.incoming):
                return
        self.fail("message loop did not settle")

    async def connect(self, page_id, kind, offset, latency=0):
        self.latency[page_id] = latency
        self.request(op="create", id=page_id, kind=kind, offset=offset)
        hub = self

        class Wire:
            async def send_text(self, text):
                hub.incoming.append((hub.now + hub.latency[page_id], page_id, json.loads(text)))

        # Use the actual page's connection purpose, just as the WS handshake does.
        conn = Connection(Wire(), "account", page_id, Seat.DIRECTOR, "match", connection_id=page_id,
            align_client=self.snapshots[page_id]["alignClient"])
        self.connections[page_id], self.kinds[page_id] = conn, kind
        self.cm._add_director(self.store, conn)
        conn.auth_sent = True
        st = self.state
        role = "publisher" if st.align_owner is conn else "follower"
        self.request(op="deliver", id=page_id, now=self.now, message={
            "type": "auth_ok", "seat": "DIRECTOR", "connection_id": page_id,
            "account_id": "account", "match_id": "match", "align_role": role,
            "align_authority_src": st.align_authority_src, "authority_epoch": st.align_epoch,
            "align_lease_required": st.lease_mode,
        })
        replay = self.cm._director_state_payload("account", "match")
        if replay:
            self.request(op="deliver", id=page_id, now=self.now, message={
                "type": "director_cmd", "action": "state_sync", "payload": {
                    **replay, "connection_id": page_id, "align_role": role, "align_lease_required": st.lease_mode,
                },
            })
        await self.pump()

    async def run_for(self, duration, owner=None, epoch=None, uninterrupted=()):
        before = {page: s["t"] for page, s in self.snapshots.items()}
        seeks = {page: self.snapshots[page]["seeks"] for page in uninterrupted}
        for _ in range(duration // 25):
            self.now += 25
            await self.pump(self.request(op="tick", now=self.now))
            await self.cm._expire_align("account", "match")
            await self.pump()
            if owner:
                self.assertIs(self.state.align_owner, self.connections[owner])
                self.assertEqual(self.state.align_epoch, epoch)
            for page in uninterrupted:
                self.assertTrue(self.snapshots[page]["stageVisible"])
                self.assertEqual(self.snapshots[page]["state"], "playing")
                self.assertGreater(self.snapshots[page]["t"], before[page])
                self.assertEqual(self.snapshots[page]["seeks"], seeks[page])
            for page, snapshot in self.snapshots.items():
                if before.get(page) is not None:
                    self.assertGreaterEqual(snapshot["t"], before[page], (page, snapshot))
                before[page] = snapshot["t"]

    async def close(self, page_id):
        conn = self.connections.pop(page_id)
        self.request(op="close", id=page_id)
        self.cm._remove_connection(self.store, conn)
        await self.pump()

    def assert_stages_play(self, *pages):
        for page in pages:
            s = self.snapshots[page]
            self.assertEqual(s["role"], "follower")
            self.assertEqual(s["state"], "playing", (page, s))
            self.assertTrue(s["stageVisible"], (page, s))
            self.assertLessEqual(abs(self.state.frame_align_t_us - s["t"]), 1000000)

    async def test_stage_first_then_one_console_and_three_independent_stages(self):
        for i, (offset, latency) in enumerate([(1000, 0), (500000, 50), (9000000, 150)]):
            await self.connect(f"stage{i}", "stage", offset, latency)
        await self.run_for(3000)
        self.assertIsNone(self.state.align_owner)
        self.assertFalse(self.frame_senders)
        self.assertTrue(all(not s["stageVisible"] and s["t"] is None for s in self.snapshots.values()))
        await self.connect("console1", "console", 20000)
        await self.run_for(6000)
        self.assertIs(self.state.align_owner, self.connections["console1"])
        self.assert_stages_play("stage0", "stage1", "stage2")
        self.assertEqual(set(self.frame_senders), {"console1"})

    async def test_second_console_does_not_preempt_then_takes_over_on_close(self):
        await self.connect("console1", "console", 4000)
        await self.connect("stage1", "stage", 700000, 50)
        await self.connect("stage2", "stage", 7000000, 125)
        await self.run_for(6000)
        self.assert_stages_play("stage1", "stage2")
        epoch, before = self.state.align_epoch, self.state.frame_align_t_us
        await self.connect("console2", "console", 40000000)
        await self.run_for(6000, owner="console1", epoch=epoch, uninterrupted=("stage1", "stage2"))
        self.assertGreater(self.state.frame_align_t_us, before)
        self.assertEqual(set(self.frame_senders), {"console1"})
        self.assert_stages_play("stage1", "stage2")
        self.assertTrue(self.cm._lease_candidate(self.connections["console2"], module._align_now_ms()))
        old_floor = self.state.frame_align_t_us
        old_conn = self.connections["console1"]
        await self.close("console1")
        self.assertIs(self.state.align_owner, self.connections["console2"])
        self.assertGreater(self.state.align_epoch, epoch)
        new_epoch = self.state.align_epoch
        await self.run_for(2000, owner="console2", epoch=new_epoch)
        self.assertGreaterEqual(self.state.frame_align_t_us, old_floor)
        self.assert_stages_play("stage1", "stage2")
        self.assertIn("console2", self.frame_senders)
        self.assertFalse(self.cm._update_director_state("account", "match", "frame_align",
            {"t_us": old_floor + 10000000, "epoch": epoch, "seq": 999}, old_conn)[0])
        await self.close("console2")
        self.assertIsNone(self.state.align_owner)
        await self.run_for(150)  # Let the no-owner notification cross the simulated links.
        self.assertTrue(all(not s["stageVisible"] for s in self.snapshots.values()))
        await self.run_for(3000)
        self.assertIsNone(self.state.align_owner)
        self.assertTrue(all(not s["stageVisible"] for s in self.snapshots.values()))

    async def test_media_wait_keepalive_freezes_without_stale_or_unnecessary_seek(self):
        await self.connect("console1", "console", 4000)
        await self.connect("stage1", "stage", 700000, 50)
        await self.run_for(6000)
        self.assert_stages_play("stage1")
        epoch = self.state.align_epoch
        seeks = self.snapshots["console1"]["seeks"]
        self.request(op="media", id="console1", available=False)
        await self.run_for(500, owner="console1", epoch=epoch)
        self.assertEqual(self.state.align_anchor["reason"], "media_wait")
        self.assertFalse(self.state.align_anchor["stale"])
        self.assertEqual(self.snapshots["console1"]["seeks"], seeks)
        self.request(op="media", id="console1", available=True)
        await self.run_for(1500, owner="console1", epoch=epoch)
        self.assert_stages_play("stage1")
        self.assertEqual(self.snapshots["console1"]["seeks"], seeks)

        self.request(op="media", id="console1", available=False)
        await self.run_for(250)
        frozen_t, frozen_seq = self.state.frame_align_t_us, self.state.align_seq
        await self.run_for(3500, owner="console1", epoch=epoch)
        self.assertEqual(self.state.frame_align_t_us, frozen_t)
        self.assertGreater(self.state.align_seq, frozen_seq)
        self.assertFalse(self.state.align_anchor["stale"])
        self.assertTrue(self.snapshots["stage1"]["authorityReady"])
        self.assertEqual(self.snapshots["stage1"]["state"], "frozen")
        self.request(op="media", id="console1", available=True)
        await self.run_for(6000, owner="console1", epoch=epoch)
        self.assertEqual(self.snapshots["stage1"]["state"], "playing")
        self.assertGreater(self.snapshots["stage1"]["t"], frozen_t)
        # A genuine >2s decoder stall can invoke publisher recovery. Followers
        # retain the existing <=1.08x soft catchup policy for gaps below 5s.
        await self.run_for(120000, owner="console1", epoch=epoch)
        self.assert_stages_play("stage1")


if __name__ == "__main__":
    unittest.main(verbosity=2)

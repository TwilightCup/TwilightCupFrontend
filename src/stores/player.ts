/**
 * 选手端模拟器状态（仅开发期用）。
 *
 * 复用 MatchSocket 做鉴权连接 / 心跳 / 重连；维护本选手视角的比赛阶段、当前
 * 回合、自己的上报进度、比分与消息日志；提供模拟「游戏内输出」的动作：
 * 准备、逐关/逐次用时上报、完成、弃权、跳过。
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";

import {
  MatchPhase,
  PickType,
  PlayerStatus,
  type Attempt,
  type LevelTime,
  type MatchPhase as MP,
  type Pick,
  type PlayerStatus as PS,
  type SeatName,
} from "@/api/types";
import { formatMs, phaseInfo, shortTime, verdictInfo } from "@/utils/format";
import { send, type ServerMessage } from "@/ws/protocol";
import { ConnStatus, MatchSocket } from "@/ws/socket";
import { useAuthStore } from "./auth";
import { t as tr } from "@/locales";

interface CurrentRound {
  roundId: string;
  pick: Pick;
  collection: { raw: Record<string, unknown> };
  type: PickType;
}

interface LogLine {
  ts: string;
  kind: string;
  text: string;
}

const MAX_LOG = 200;

function clock(): string {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

export const usePlayerStore = defineStore("player", () => {
  const auth = useAuthStore();
  const socket = new MatchSocket();

  const connStatus = ref<ConnStatus>("idle");
  const seat = ref<SeatName | "">("");
  const matchId = ref("");
  const phase = ref<MP>(MatchPhase.IDLE);
  const aReady = ref(false);
  const bReady = ref(false);
  const currentRound = ref<CurrentRound | null>(null);
  const myLevels = ref<LevelTime[]>([]);
  const myAttempts = ref<Attempt[]>([]);
  const myStatus = ref<PS>(PlayerStatus.IN_GAME);
  const myCurrentLevelIndex = ref(0);
  const winsA = ref(0);
  const winsB = ref(0);
  const threshold = ref(0);
  const matchWinner = ref<"A" | "B" | null>(null);
  const countdownRemaining = ref<number | null>(null);
  const authErrorMessage = ref("");
  const messages = ref<LogLine[]>([]);

  socket.onStatusChange = (s) => {
    connStatus.value = s;
  };
  socket.onMessage = (msg) => handle(msg);

  const side = computed<"A" | "B" | "">(() => {
    if (seat.value === "PLAYER_A") return "A";
    if (seat.value === "PLAYER_B") return "B";
    return "";
  });
  const isMulti = computed(
    () => currentRound.value?.type === PickType.MULTI,
  );
  /** 多关：collection.raw.levels 的数量；解析失败回退 0 */
  const levelCount = computed(() => {
    const raw = currentRound.value?.collection?.raw as
      | Record<string, unknown>
      | undefined;
    const levels = raw?.levels;
    return Array.isArray(levels) ? levels.length : 0;
  });
  /** 单关：pick.retry_count；解析失败回退 1 */
  const retryCount = computed(
    () => currentRound.value?.pick?.retry_count ?? 1,
  );
  const myDone = computed(
    () =>
      myStatus.value === PlayerStatus.COMPLETED ||
      myStatus.value === PlayerStatus.FORFEITED,
  );

  function log(kind: string, text: string, ts?: string): void {
    // 统一展示为 HH:MM:SS：服务器 ISO（聊天/系统）经 shortTime，本地事件用 clock()
    messages.value.unshift({ ts: ts ? shortTime(ts) : clock(), kind, text });
    if (messages.value.length > MAX_LOG) messages.value.length = MAX_LOG;
  }

  function resetProgress(): void {
    myLevels.value = [];
    myAttempts.value = [];
    myStatus.value = PlayerStatus.IN_GAME;
    myCurrentLevelIndex.value = 0;
  }

  function handle(msg: ServerMessage): void {
    switch (msg.type) {
      case "auth_ok":
        seat.value = msg.seat;
        matchId.value = msg.match_id;
        authErrorMessage.value = "";
        log("auth", tr("log.joinedMatch", { seat: msg.seat }));
        break;
      case "auth_error":
        authErrorMessage.value = msg.msg;
        break;
      case "phase_change":
        phase.value = msg.phase;
        log("phase", tr("log.phaseChange", { label: phaseInfo(msg.phase).label }));
        // 比赛结束（含管理员强制结束）：选手自动断连，无需任何操作
        if (msg.phase === MatchPhase.MATCH_END) {
          log("match", tr("log.matchEndAutoDisconnect"));
          disconnect();
        }
        break;
      case "ready_state":
        aReady.value = msg.a_ready;
        bReady.value = msg.b_ready;
        break;
      case "round_start":
        currentRound.value = {
          roundId: msg.round_id,
          pick: msg.pick,
          collection: msg.collection,
          type: msg.pick.type,
        };
        resetProgress();
        matchWinner.value = null;
        log(
          "round",
          tr("log.roundStart", {
            code: msg.pick.code,
            name: msg.pick.name,
            type:
              msg.pick.type === PickType.SINGLE
                ? tr("pickType.single")
                : tr("pickType.multi"),
          }),
        );
        break;
      case "countdown_tick":
        countdownRemaining.value = msg.remaining_secs;
        break;
      case "countdown_abort":
        countdownRemaining.value = null;
        log("countdown", tr("log.countdownAbort", { reason: msg.reason }));
        break;
      case "player_status":
        if (msg.seat === seat.value) {
          myStatus.value = msg.status;
          myCurrentLevelIndex.value = msg.current_level_index;
          myLevels.value = msg.completed_levels;
          myAttempts.value = msg.attempts;
        }
        break;
      case "level_time_update":
        if (msg.seat !== seat.value) {
          log(
            "opp",
            tr("log.oppLevelReport", {
              idx: msg.level_index + 1,
              time: formatMs(msg.this_level_ms),
            }),
          );
        }
        break;
      case "round_result":
        log("result", tr("log.roundResult", { label: verdictInfo(msg.verdict).label }));
        break;
      case "cumulative_score":
        winsA.value = msg.wins_a;
        winsB.value = msg.wins_b;
        threshold.value = msg.threshold;
        break;
      case "match_end":
        matchWinner.value = msg.winner;
        log("match", tr("log.matchEndWinner", { winner: msg.winner }));
        break;
      case "verdict_edit":
        log(
          "system",
          tr("log.verdictEdit", {
            old: verdictInfo(msg.old_verdict).label,
            new: verdictInfo(msg.new_verdict).label,
          }),
        );
        break;
      case "chat":
        log("chat", `${msg.sender_name}：${msg.text}`, msg.ts);
        break;
      case "system":
        log("system", msg.text, msg.ts);
        break;
      case "error":
        log("error", tr("log.errorLog", { code: msg.code, msg: msg.msg }));
        break;
      default:
        // counter_state / counter_alert / round_started_broadcast 等忽略
        break;
    }
  }

  // ---- 连接 ----
  function connect(): void {
    if (!auth.token) return;
    socket.connect(auth.token);
  }
  function disconnect(): void {
    socket.disconnect();
  }

  // ---- 模拟「游戏内输出」----
  // 注意：后端 connection_manager 未 dispatch `ready_toggle`，准备切换走聊天命令
  // `!ready`（见后端 commands.py:_ready）。故此处发 chat 而非 ready_toggle。
  function toggleReady(): void {
    socket.send(send.chat("!ready"));
  }
  /** 发送聊天消息（选手也可在房间发言 / 用 `!` 命令如 !roll） */
  function sendChat(text: string): void {
    const t = text.trim();
    if (!t) return;
    socket.send(send.chat(t));
  }
  function uploadLevel(
    levelIndex: number,
    thisLevelMs: number,
    totalMs: number | null = null,
  ): void {
    const rid = currentRound.value?.roundId;
    if (!rid) return;
    socket.send(send.levelTimeUpload(rid, levelIndex, thisLevelMs, totalMs));
  }
  function skipAttempt(attemptIndex: number): void {
    const rid = currentRound.value?.roundId;
    if (!rid) return;
    socket.send(send.attemptSkip(rid, attemptIndex));
  }
  function complete(finalTotalMs: number | null = null): void {
    const rid = currentRound.value?.roundId;
    if (!rid) return;
    socket.send(send.projectComplete(rid, finalTotalMs));
  }
  function forfeit(reason: "multi_exit" | "single_exit_0_valid"): void {
    const rid = currentRound.value?.roundId;
    if (!rid) return;
    socket.send(send.forfeitSignal(rid, reason));
  }

  return {
    // 状态
    connStatus,
    seat,
    matchId,
    phase,
    aReady,
    bReady,
    currentRound,
    myLevels,
    myAttempts,
    myStatus,
    myCurrentLevelIndex,
    winsA,
    winsB,
    threshold,
    matchWinner,
    countdownRemaining,
    authErrorMessage,
    messages,
    // 派生
    side,
    isMulti,
    levelCount,
    retryCount,
    myDone,
    // 动作
    connect,
    disconnect,
    toggleReady,
    sendChat,
    uploadLevel,
    skipAttempt,
    complete,
    forfeit,
  };
});

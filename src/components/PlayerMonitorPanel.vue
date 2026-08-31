<script setup lang="ts">
import { watch } from "vue";
import { useMatchStore } from "@/stores/match";
import { useAuthStore } from "@/stores/auth";
import StreamFrame from "@/scenes/match/StreamFrame.vue";
import { useRefereeStreamConfig } from "@/composables/useRefereeStreamConfig";

const match = useMatchStore();
const auth = useAuthStore();
const { config, load, save } = useRefereeStreamConfig();

watch(
  () => match.matchId,
  (id) => {
    if (id) load(id, {});
  },
  { immediate: true },
);

function refreshStream(side: "A" | "B"): void {
  if (!match.matchId) return;
  const key = side === "A" ? "refreshA" : "refreshB";
  save(match.matchId, { [key]: config[key] + 1 });
}
</script>

<template>
  <section class="monitor">
    <div class="title">{{ $t('matchView.streamMonitorTitle') }}</div>
    <div class="monitor-grid">
      <div class="monitor-side">
        <div class="side-head">
          <span class="name tc-a">A · {{ match.playerNames.A || $t('seat.a') }}</span>
          <el-button size="small" @click="refreshStream('A')">
            {{ $t('matchView.streamRefreshBtn') }}
          </el-button>
        </div>
        <StreamFrame
          side="A"
          :hls-url="config.hlsA"
          :embed-url="config.embedA"
          :token="auth.token"
          :refresh-nonce="config.refreshA"
          :crop4to3="false"
        />
      </div>
      <div class="monitor-side">
        <div class="side-head">
          <span class="name tc-b">B · {{ match.playerNames.B || $t('seat.b') }}</span>
          <el-button size="small" @click="refreshStream('B')">
            {{ $t('matchView.streamRefreshBtn') }}
          </el-button>
        </div>
        <StreamFrame
          side="B"
          :hls-url="config.hlsB"
          :embed-url="config.embedB"
          :token="auth.token"
          :refresh-nonce="config.refreshB"
          :crop4to3="false"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.monitor {
  --syn-a: #3d8bff;
  --syn-b: #ff6b4a;
  --syn-a-glow: rgba(61, 139, 255, 0.55);
  --syn-b-glow: rgba(255, 107, 74, 0.55);
  --syn-a-glow-soft: rgba(61, 139, 255, 0.25);
  --syn-b-glow-soft: rgba(255, 107, 74, 0.25);
  --syn-magenta: #ff2e88;
  --syn-text-dim: #a99bd6;
  background: var(--tc-bg-soft);
  border: 1px solid var(--tc-border);
  border-radius: 10px;
  padding: 12px 14px;
  margin-bottom: 12px;
}
.title {
  font-size: 13px;
  font-weight: 600;
  color: var(--tc-text-dim);
  margin-bottom: 8px;
}
.monitor-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.monitor-side {
  min-width: 0;
}
.side-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}
.side-head .name {
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>

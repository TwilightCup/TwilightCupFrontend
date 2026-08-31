<script setup lang="ts">
import { watch } from "vue";
import { Refresh } from "@element-plus/icons-vue";
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
    <div class="monitor-grid">
      <div class="monitor-side">
        <div class="stream-wrap">
          <StreamFrame
            side="A"
            :hls-url="config.hlsA"
            :embed-url="config.embedA"
            :token="auth.token"
            :refresh-nonce="config.refreshA"
            :crop4to3="false"
          />
          <button
            type="button"
            class="refresh-btn"
            :title="$t('matchView.streamRefreshBtn')"
            @click="refreshStream('A')"
          >
            <el-icon :size="16"><Refresh /></el-icon>
          </button>
        </div>
      </div>
      <div class="monitor-side">
        <div class="stream-wrap">
          <StreamFrame
            side="B"
            :hls-url="config.hlsB"
            :embed-url="config.embedB"
            :token="auth.token"
            :refresh-nonce="config.refreshB"
            :crop4to3="false"
          />
          <button
            type="button"
            class="refresh-btn"
            :title="$t('matchView.streamRefreshBtn')"
            @click="refreshStream('B')"
          >
            <el-icon :size="16"><Refresh /></el-icon>
          </button>
        </div>
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
.monitor-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.monitor-side {
  min-width: 0;
}
.stream-wrap {
  position: relative;
  width: 100%;
  display: flex;
  flex-direction: column;
}
.refresh-btn {
  position: absolute;
  right: 10px;
  bottom: 10px;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  border: 1px solid rgba(255, 255, 255, 0.5);
  color: #fff;
  cursor: pointer;
  z-index: 2;
  transition: background 0.2s;
}
.refresh-btn:hover {
  background: rgba(0, 0, 0, 0.7);
}
</style>

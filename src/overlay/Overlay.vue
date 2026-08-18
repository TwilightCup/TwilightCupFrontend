<script setup lang="ts">
/**
 * 导播叠加层（独立入口 overlay.html 的根组件）。
 *
 * 透明背景，OBS 浏览器源叠加在游戏画面上。token 从 URL ?token= 取，WS 连后端
 * （seat=DIRECTOR）。配色全部内联固定（不引 global.css / 不受主题切换影响）。
 * 本版为基础渲染，ban/pick 面板与转场动画由 GSAP 任务补齐。
 */
import { computed, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { useDirectorStore } from "@/stores/director";
import { MatchPhase, PlayerStatus } from "@/api/types";
import { phaseInfo, verdictInfo } from "@/utils/format";
import { useSceneContext } from "@/scenes/composables/useSceneContext";

const { t } = useI18n();
const director = useDirectorStore();
const { params, hosted } = useSceneContext();
const token = params.token;
const matchId = params.matchId || undefined;

// 对阵色（固定，不随主题）
const A = "#3d8bff";
const B = "#ff6b4a";

const phaseLabel = computed(() => phaseInfo(director.phase).label);
const showCountdown = computed(
  () =>
    director.phase === MatchPhase.COUNTDOWN &&
    director.countdownRemaining != null,
);
const countingLow = computed(() => (director.countdownRemaining ?? 99) <= 3);
const showRound = computed(
  () =>
    !!director.currentRound &&
    (director.phase === MatchPhase.IN_ROUND ||
      director.phase === MatchPhase.ROUND_JUDGING),
);
const matchOver = computed(
  () => director.phase === MatchPhase.MATCH_END || !!director.matchWinner,
);
const verdictText = computed(() => {
  const v = director.lastResult?.verdict;
  return v != null ? verdictInfo(v).label : "";
});

function statusText(side: "A" | "B"): string {
  const s = director.playerOf(side).status;
  if (s === PlayerStatus.COMPLETED) return t("playerStatus.completedShort");
  if (s === PlayerStatus.FORFEITED) return t("playerStatus.forfeitShort");
  return "";
}
function isCompleted(side: "A" | "B"): boolean {
  return director.playerOf(side).status === PlayerStatus.COMPLETED;
}
function progressText(side: "A" | "B"): string {
  if (!director.currentRound) return "";
  const p = director.playerOf(side);
  return director.isMulti
    ? t("directorView.progLevel", { idx: p.currentLevelIndex })
    : t("directorView.progAttempt", { count: p.attempts.length });
}

onMounted(() => {
  // hosted（合并舞台）模式下 WS 由舞台根统一连；独立入口才自己连
  if (!hosted && token) director.connect(token, matchId);
});
onUnmounted(() => {
  if (!hosted) director.disconnect();
});
</script>

<template>
  <div v-if="!token" class="notice">
    {{ $t('overlay.noToken') }}
  </div>
  <div v-else class="overlay">
    <!-- 顶部：比赛名 + 阶段 -->
    <div class="top-bar">
      <span class="match-name">{{ director.matchName || $t('brand.overlayFallback') }}</span>
      <span v-if="director.boFormat" class="bo">BO{{ director.boFormat }}</span>
      <span class="phase">{{ phaseLabel }}</span>
    </div>

    <!-- 中央 -->
    <div class="center">
      <div
        v-if="showCountdown"
        class="countdown"
        :class="{ low: countingLow }"
        :key="'cd' + director.countdownRemaining"
      >
        {{ director.countdownRemaining }}
      </div>
      <div v-if="showRound && director.currentRound" class="round-info">
        <div class="pick-code">{{ director.currentRound.pick.code }}</div>
        <div class="pick-name">{{ director.currentRound.pick.name }}</div>
      </div>
      <div v-if="matchOver && director.matchWinner" class="match-winner">
        {{ $t('overlay.matchWinner', { winner: director.matchWinner }) }}
      </div>
      <div v-if="verdictText" class="verdict-flash">{{ verdictText }}</div>
    </div>

    <!-- 左下：选手A -->
    <div class="player-card side-a" :class="{ done: isCompleted('A') }">
      <div class="pinfo">
        <div class="pname" :style="{ color: A }">{{ director.nameOf("A") }}</div>
        <div class="pprog">{{ progressText("A") }}<span v-if="statusText('A')"> · {{ statusText("A") }}</span></div>
      </div>
      <div class="pscore" :style="{ color: A }">{{ director.winsA }}</div>
    </div>

    <!-- 右下：选手B -->
    <div class="player-card side-b" :class="{ done: isCompleted('B') }">
      <div class="pscore" :style="{ color: B }">{{ director.winsB }}</div>
      <div class="pinfo">
        <div class="pname" :style="{ color: B }">{{ director.nameOf("B") }}</div>
        <div class="pprog">{{ progressText("B") }}<span v-if="statusText('B')"> · {{ statusText('B') }}</span></div>
      </div>
    </div>

    <div v-if="director.connStatus !== 'open'" class="conn-badge">
      {{ director.connStatus }}
    </div>
  </div>
</template>

<style scoped>
/* 叠加层独立配色：透明背景 + 白字 + 金强调 + 对阵色（全固定，不随主题） */
.notice {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 14px;
  padding: 24px;
  text-align: center;
}
.overlay {
  position: fixed;
  inset: 0;
  color: #fff;
  font-family: "Inter", "PingFang SC", system-ui, sans-serif;
  pointer-events: none;
  overflow: hidden;
}
.top-bar {
  position: absolute;
  top: 3vh;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 1.2vw;
  padding: 0.6vw 1.4vw;
  background: rgba(10, 12, 18, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  backdrop-filter: blur(8px);
  font-size: clamp(13px, 1.5vw, 22px);
}
.match-name { font-weight: 700; }
.bo { color: rgba(255, 255, 255, 0.6); }
.phase { color: #f0a020; font-weight: 700; }
.center {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
}
.countdown {
  font-size: clamp(120px, 16vw, 280px);
  font-weight: 900;
  line-height: 1;
  text-shadow: 0 0 40px rgba(255, 209, 102, 0.6), 0 6px 0 rgba(0, 0, 0, 0.4);
}
.countdown.low {
  color: #ff4d4d;
  animation: pulse 0.6s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.12); }
}
.pick-code {
  font-size: clamp(28px, 4vw, 64px);
  font-weight: 900;
  color: #f0a020;
  text-shadow: 0 0 30px rgba(240, 160, 32, 0.6), 0 4px 0 rgba(0, 0, 0, 0.4);
}
.pick-name {
  font-size: clamp(16px, 1.8vw, 30px);
  text-shadow: 0 2px 6px rgba(0, 0, 0, 0.6);
}
.match-winner {
  font-size: clamp(30px, 5vw, 80px);
  font-weight: 900;
  color: gold;
  text-shadow: 0 0 50px rgba(255, 215, 0, 0.7), 0 6px 0 rgba(0, 0, 0, 0.4);
}
.verdict-flash {
  margin-top: 1vh;
  display: inline-block;
  padding: 0.4vw 1.6vw;
  background: rgba(240, 160, 32, 0.92);
  color: #1a1205;
  font-size: clamp(20px, 2.4vw, 38px);
  font-weight: 900;
  border-radius: 8px;
}
.player-card {
  position: absolute;
  bottom: 4vh;
  display: flex;
  align-items: center;
  gap: 1.2vw;
  padding: 1vh 1.4vw;
  background: rgba(10, 12, 18, 0.78);
  border: 2px solid rgba(255, 255, 255, 0.1);
  border-radius: 14px;
  backdrop-filter: blur(8px);
}
.player-card.side-a { left: 3vw; border-left: 6px solid #3d8bff; }
.player-card.side-b { right: 3vw; border-right: 6px solid #ff6b4a; }
.player-card.done { border-color: #37d27a; box-shadow: 0 0 24px rgba(55, 210, 122, 0.5); }
.pinfo { text-align: left; }
.side-b .pinfo { text-align: right; }
.pname {
  font-size: clamp(18px, 2.2vw, 36px);
  font-weight: 800;
  text-shadow: 0 2px 6px rgba(0, 0, 0, 0.6);
}
.pprog { font-size: clamp(12px, 1.2vw, 18px); color: rgba(255, 255, 255, 0.65); }
.pscore {
  font-size: clamp(48px, 7vw, 120px);
  font-weight: 900;
  line-height: 1;
  min-width: 1.2em;
  text-align: center;
  text-shadow: 0 4px 0 rgba(0, 0, 0, 0.4);
}
.conn-badge {
  position: absolute;
  top: 1vh;
  right: 1vw;
  font-size: 12px;
  color: #ff9a9a;
  background: rgba(0, 0, 0, 0.5);
  padding: 2px 8px;
  border-radius: 4px;
}
</style>

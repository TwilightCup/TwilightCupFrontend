<script setup lang="ts">
/**
 * OBS 浏览器源叠加层（/overlay?token=...）。
 *
 * 透明背景，OBS 里作为浏览器源叠加在游戏画面上。token 由导播控制台生成的链接
 * 带入（onMounted 用其连 WS）。带动画：比分变化弹跳高亮、倒计时脉动、阶段切换
 * 淡入、回合选图滑入、胜方奖杯弹出。
 */
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import { useDirectorStore } from "@/stores/director";
import { MatchPhase, PlayerStatus } from "@/api/types";
import { phaseInfo, verdictInfo } from "@/utils/format";

const route = useRoute();
const director = useDirectorStore();
const { t } = useI18n();

const token = (route.query.token as string) ?? "";

// ---- 动画触发器 ----
const scorePulseA = ref(false);
const scorePulseB = ref(false);
function pulse(side: "A" | "B") {
  const r = side === "A" ? scorePulseA : scorePulseB;
  r.value = false;
  requestAnimationFrame(() => (r.value = true));
  setTimeout(() => (r.value = false), 900);
}
watch(
  () => director.winsA,
  (n, old) => {
    if (n > (old ?? 0)) pulse("A");
  },
);
watch(
  () => director.winsB,
  (n, old) => {
    if (n > (old ?? 0)) pulse("B");
  },
);

const phaseKey = ref(0);
watch(
  () => director.phase,
  () => (phaseKey.value += 1),
);

const roundKey = ref(0);
watch(
  () => director.currentRound?.roundId,
  () => (roundKey.value += 1),
);

const flashKey = ref(0);
watch(
  () => director.lastResult,
  () => (flashKey.value += 1),
);

// ---- 派生 ----
const showCountdown = computed(
  () =>
    director.phase === MatchPhase.COUNTDOWN &&
    director.countdownRemaining != null,
);
const showRound = computed(
  () =>
    !!director.currentRound &&
    (director.phase === MatchPhase.IN_ROUND ||
      director.phase === MatchPhase.ROUND_JUDGING),
);
const countingLow = computed(() => (director.countdownRemaining ?? 99) <= 3);
const matchOver = computed(
  () => director.phase === MatchPhase.MATCH_END || !!director.matchWinner,
);
const phaseLabel = computed(() => phaseInfo(director.phase).label);
const verdictText = computed(() => {
  const v = director.lastResult?.verdict;
  if (v == null) return "";
  return verdictInfo(v).label;
});

function progressText(side: "A" | "B"): string {
  if (!director.currentRound) return "";
  const p = director.playerOf(side);
  return director.isMulti
    ? t("directorView.progLevel", { idx: p.currentLevelIndex })
    : t("directorView.progAttempt", { count: p.attempts.length });
}
function statusText(side: "A" | "B"): string {
  const s = director.playerOf(side).status;
  if (s === PlayerStatus.COMPLETED) return t("playerStatus.completedShort");
  if (s === PlayerStatus.FORFEITED) return t("playerStatus.forfeitShort");
  return "";
}
function isDone(side: "A" | "B"): boolean {
  return director.playerOf(side).status === PlayerStatus.COMPLETED;
}
function isDead(side: "A" | "B"): boolean {
  return director.playerOf(side).status === PlayerStatus.FORFEITED;
}

onMounted(() => {
  if (!token) return;
  // OBS 浏览器源默认透明：把 body 也置透明，叠加在游戏画面上
  document.body.style.background = "transparent";
  director.connect(token);
});
onUnmounted(() => {
  director.disconnect();
  document.body.style.background = "";
});
</script>

<template>
  <div class="overlay">
    <div v-if="!token" class="notice">
      <div class="notice-card">
        <b>{{ $t('brand.overlayTitle') }}</b>
        <p>{{ $t('overlay.noToken') }}</p>
      </div>
    </div>

    <template v-else>
      <!-- 顶部：比赛名 + 阶段 -->
      <Transition name="fade" mode="out-in">
        <div :key="phaseKey" class="top-bar">
          <span class="match-name">{{ director.matchName || $t('brand.overlayFallback') }}</span>
          <span v-if="director.boFormat" class="bo">BO{{ director.boFormat }}</span>
          <span class="phase" :class="phaseLabel">{{ phaseLabel }}</span>
        </div>
      </Transition>

      <!-- 中央 -->
      <div class="center">
        <Transition name="pop">
          <div
            v-if="showCountdown"
            :key="'cd' + director.countdownRemaining"
            class="countdown"
            :class="{ low: countingLow }"
          >
            {{ director.countdownRemaining }}
          </div>
        </Transition>

        <Transition name="slide-up" mode="out-in">
          <div
            v-if="showRound && director.currentRound"
            :key="roundKey"
            class="round-info"
          >
            <div class="pick-code">{{ director.currentRound.pick.code }}</div>
            <div class="pick-name">{{ director.currentRound.pick.name }}</div>
          </div>
        </Transition>

        <Transition name="pop">
          <div v-if="matchOver && director.matchWinner" class="match-winner">
            {{ $t('overlay.matchWinner', { winner: director.matchWinner }) }}
          </div>
        </Transition>
      </div>

      <!-- 左下：选手A -->
      <div
        class="player-card side-a"
        :class="{ scored: scorePulseA, done: isDone('A'), dead: isDead('A') }"
      >
        <div class="pinfo">
          <div class="pname">{{ director.nameOf("A") }}</div>
          <div class="pprog">
            {{ progressText("A") }}<span v-if="statusText('A')" class="pstat"> · {{ statusText("A") }}</span>
          </div>
        </div>
        <div class="pscore">{{ director.winsA }}</div>
      </div>

      <!-- 右下：选手B -->
      <div
        class="player-card side-b"
        :class="{ scored: scorePulseB, done: isDone('B'), dead: isDead('B') }"
      >
        <div class="pscore">{{ director.winsB }}</div>
        <div class="pinfo">
          <div class="pname">{{ director.nameOf("B") }}</div>
          <div class="pprog">
            {{ progressText("B") }}<span v-if="statusText('B')" class="pstat"> · {{ statusText("B") }}</span>
          </div>
        </div>
      </div>

      <!-- 回合判定提示（飞入） -->
      <Transition name="fly-in">
        <div v-if="director.lastResult" :key="flashKey" class="verdict-flash">
          {{ verdictText }}
        </div>
      </Transition>

      <!-- 连接异常角标 -->
      <div v-if="director.connStatus !== 'open'" class="conn-badge">
        {{ director.connStatus }}
      </div>
    </template>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: transparent;
  color: #fff;
  font-family: "Inter", "PingFang SC", system-ui, sans-serif;
  pointer-events: none;
  overflow: hidden;
}

/* 无 token 提示 */
.notice {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  pointer-events: auto;
}
.notice-card {
  width: 520px;
  max-width: 80vw;
  padding: 24px;
  background: #171a21;
  border: 1px solid #262b36;
  border-radius: 12px;
  font-size: 14px;
}
.notice-card code {
  background: #0c0e12;
  padding: 1px 5px;
  border-radius: 4px;
}

/* 顶部条 */
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
  letter-spacing: 0.5px;
}
.match-name {
  font-weight: 700;
}
.bo {
  color: rgba(255, 255, 255, 0.65);
}
.phase {
  color: #f0a020;
  font-weight: 700;
}

/* 中央 */
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
  color: #fff;
  text-shadow: 0 0 40px rgba(255, 209, 102, 0.6), 0 6px 0 rgba(0, 0, 0, 0.4);
}
.countdown.low {
  color: #ff4d4d;
  text-shadow: 0 0 60px rgba(255, 60, 60, 0.85), 0 6px 0 rgba(0, 0, 0, 0.4);
  animation: lowPulse 0.6s ease-in-out infinite;
}
.round-info {
  margin-top: 1vh;
}
.pick-code {
  font-size: clamp(28px, 4vw, 64px);
  font-weight: 900;
  color: #f0a020;
  text-shadow: 0 0 30px rgba(240, 160, 32, 0.6), 0 4px 0 rgba(0, 0, 0, 0.4);
}
.pick-name {
  font-size: clamp(16px, 1.8vw, 30px);
  color: #fff;
  text-shadow: 0 2px 6px rgba(0, 0, 0, 0.6);
}
.match-winner {
  font-size: clamp(30px, 5vw, 80px);
  font-weight: 900;
  color: gold;
  text-shadow: 0 0 50px rgba(255, 215, 0, 0.7), 0 6px 0 rgba(0, 0, 0, 0.4);
}

/* 选手卡片（底部左右） */
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
  transition: border-color 0.3s, box-shadow 0.3s;
}
.player-card.side-a {
  left: 3vw;
  border-left: 6px solid var(--tc-a);
}
.player-card.side-b {
  right: 3vw;
  border-right: 6px solid var(--tc-b);
}
.player-card.done {
  border-color: #37d27a;
  box-shadow: 0 0 24px rgba(55, 210, 122, 0.5);
}
.player-card.dead {
  border-color: #ff4d4d;
  opacity: 0.7;
}
.pinfo {
  text-align: left;
}
.side-b .pinfo {
  text-align: right;
}
.pname {
  font-size: clamp(18px, 2.2vw, 36px);
  font-weight: 800;
  text-shadow: 0 2px 6px rgba(0, 0, 0, 0.6);
}
.side-a .pname {
  color: var(--tc-a);
}
.side-b .pname {
  color: var(--tc-b);
}
.pprog {
  font-size: clamp(12px, 1.2vw, 18px);
  color: rgba(255, 255, 255, 0.65);
}
.pstat {
  color: #37d27a;
}
.pscore {
  font-size: clamp(48px, 7vw, 120px);
  font-weight: 900;
  line-height: 1;
  min-width: 1.2em;
  text-align: center;
  text-shadow: 0 4px 0 rgba(0, 0, 0, 0.4);
  transition: color 0.2s;
}
.side-a .pscore {
  color: var(--tc-a);
}
.side-b .pscore {
  color: var(--tc-b);
}
.player-card.scored {
  animation: cardGlow 0.9s ease-out;
}
.player-card.scored .pscore {
  animation: scorePop 0.9s ease-out;
}

/* 判定飞入 */
.verdict-flash {
  position: absolute;
  top: 18%;
  left: 50%;
  transform: translateX(-50%);
  padding: 0.6vw 2vw;
  background: rgba(240, 160, 32, 0.92);
  color: #1a1205;
  font-size: clamp(20px, 2.4vw, 38px);
  font-weight: 900;
  border-radius: 8px;
  letter-spacing: 1px;
}

/* 连接角标 */
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

/* ---- 动画 ---- */
@keyframes scorePop {
  0% {
    transform: scale(1);
  }
  35% {
    transform: scale(1.6);
    color: gold;
    text-shadow: 0 0 40px gold;
  }
  100% {
    transform: scale(1);
  }
}
@keyframes cardGlow {
  0%,
  100% {
    box-shadow: 0 0 0 rgba(255, 215, 0, 0);
  }
  40% {
    box-shadow: 0 0 36px rgba(255, 215, 0, 0.85);
  }
}
@keyframes lowPulse {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.12);
  }
}

/* Vue <Transition> 类 */
.fade-enter-active {
  transition: opacity 0.4s, transform 0.4s;
}
.fade-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}
.fade-enter-from {
  opacity: 0;
  transform: translate(-50%, -8px);
}
.fade-leave-to {
  opacity: 0;
}
.pop-enter-active {
  animation: popIn 0.5s cubic-bezier(0.2, 1.4, 0.4, 1);
}
@keyframes popIn {
  from {
    transform: scale(0.2);
    opacity: 0;
  }
  60% {
    transform: scale(1.15);
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}
.slide-up-enter-active {
  animation: slideUp 0.5s ease-out;
}
@keyframes slideUp {
  from {
    transform: translateY(50px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}
.fly-in-enter-active {
  animation: flyIn 0.5s cubic-bezier(0.2, 1.4, 0.4, 1);
}
.fly-in-leave-active {
  animation: flyOut 0.4s ease-in forwards;
}
@keyframes flyIn {
  from {
    transform: translate(-50%, -40px) scale(0.6);
    opacity: 0;
  }
  to {
    transform: translate(-50%, 0) scale(1);
    opacity: 1;
  }
}
@keyframes flyOut {
  to {
    transform: translate(-50%, -20px) scale(0.8);
    opacity: 0;
  }
}
</style>

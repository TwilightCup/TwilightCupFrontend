<script setup lang="ts">
/**
 * Coming Soon / 倒计时背景场景。
 *
 * 合成器浪潮背景之上：
 *   上部：品牌 logo + 赛事名 + 赛事状态（真实赛事取自 /me/tournaments；
 *         孤立比赛回退比赛名/比赛状态，均双语）
 *   屏幕正中央（绝对居中）："即将开始 / Coming Soon" 双语或倒计时数字，
 *   倒计时结束显示"马上开始 / Starting Soon"（由导播控制台经 WS 广播操控）
 *
 * 数据来源：director store（hosted 模式下由舞台根统一连 WS，本组件只读）。
 * 倒计时状态：director.soonCmdState（WS 广播权威来源）。
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useDirectorStore } from "@/stores/director";
import { api } from "@/api/client";
import { DEFAULT_TOURNAMENT_ID, type TournamentOut } from "@/api/types";
import {
  matchStatusLabelKey,
  phaseLabelKey,
  tournamentStatusLabelKey,
} from "@/utils/format";
import { bi, biPair } from "@/utils/bilingual";
import { useSceneContext } from "@/scenes/composables/useSceneContext";

const director = useDirectorStore();
const { params, sharedBg } = useSceneContext();

/** 品牌默认 logo（统一位置 public/logo.png） */
const DEFAULT_LOGO = "/logo.png";

// ---- 赛事信息（logo 下：赛事名 + 赛事状态）----
// 真实赛事从 /me/tournaments 取名字与状态；默认容器（孤立比赛）名字无意义，
// 回退当前比赛名 + 比赛状态；再兜底品牌名。
const tournament = ref<TournamentOut | null>(null);

const eventName = computed(
  () => tournament.value?.name || director.matchName || bi("soon.noMatch"),
);
const statusText = computed(() => {
  if (tournament.value) return bi(tournamentStatusLabelKey(tournament.value.status));
  if (director.matchStatus !== null) return bi(matchStatusLabelKey(director.matchStatus));
  return bi(phaseLabelKey(director.phase));
});

// ---- 倒计时状态（从 director store 读取，WS 广播权威来源）----
const soonState = computed(() => director.soonCmdState);
const remainingMs = ref(0);
let timerId: ReturnType<typeof setInterval> | null = null;

/** 计算剩余毫秒数 */
function calcRemaining(): number {
  const s = soonState.value;
  if (s.startedAt === null) return 0;
  if (s.pausedAt !== null) {
    // 暂停中：从暂停时刻算已过时间
    const elapsed = s.pausedAt - s.startedAt;
    return Math.max(0, s.targetMs - elapsed);
  }
  // 运行中
  const elapsed = Date.now() - s.startedAt;
  return Math.max(0, s.targetMs - elapsed);
}

/** 是否已完成倒计时 */
const isFinished = computed(() => remainingMs.value <= 0 && soonState.value.startedAt !== null);

/** 格式化 mm:ss */
function fmt(ms: number): string {
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** 中央大字（双语堆叠展示用一对；倒计时中为数字） */
const comingPair = biPair("soon.comingSoon");
const finishedPair = biPair("soon.finished");

/** 状态标签文字（倒计时中显示在数字下方） */
const statusTag = computed(() => {
  const s = soonState.value;
  if (s.startedAt === null) return "";
  if (s.pausedAt !== null) return bi("directorView.soonPaused");
  if (isFinished.value) return bi("directorView.soonFinished");
  return bi("directorView.soonRunning");
});

/** 赛事元数据只拉一次（挂载时）；场景切换重挂会重拉，端点轻量可接受 */
async function loadTournament(): Promise<void> {
  const tid = params.tournamentId;
  if (!params.token || !tid || tid === DEFAULT_TOURNAMENT_ID) return;
  try {
    const list = await api.listMyTournaments(params.token);
    tournament.value = list.find((x: TournamentOut) => x.id === tid) ?? null;
  } catch {
    // 非赛事成员 / 网络失败：回退比赛名/状态展示
  }
}

function tick(): void {
  remainingMs.value = calcRemaining();
}

onMounted(() => {
  void loadTournament();
  tick();
  timerId = setInterval(tick, 200); // 200ms 刷新够平滑
});

onUnmounted(() => {
  if (timerId) clearInterval(timerId);
});
</script>

<template>
  <div class="scene scanlines">
    <SynthwaveBg v-if="!sharedBg" />

    <div class="content soon-content">
      <!-- 上部：品牌 logo + 赛事名 + 赛事状态 -->
      <header class="brand-header">
        <img :src="DEFAULT_LOGO" class="logo" alt="logo" />
        <h1 class="tournament-name neon-text">{{ eventName }}</h1>
        <span class="phase neon-text-cyan">{{ statusText }}</span>
      </header>

      <!-- 屏幕正中央：Coming Soon / 倒计时（绝对居中，不受头部高度影响） -->
      <main class="center-block">
        <div
          v-if="soonState.startedAt === null"
          class="center-main idle"
        >
          <div class="zh">{{ comingPair.zh }}</div>
          <div class="en">{{ comingPair.en }}</div>
        </div>
        <div v-else-if="isFinished" class="center-main finished">
          <div class="zh">{{ finishedPair.zh }}</div>
          <div class="en">{{ finishedPair.en }}</div>
        </div>
        <template v-else>
          <div class="center-main counting">{{ fmt(remainingMs) }}</div>
          <div v-if="statusTag" class="status-label neon-text-dim">{{ statusTag }}</div>
        </template>
      </main>
    </div>
  </div>
</template>

<style scoped>
.scene {
  position: relative;
  height: 100%;
}
.soon-content {
  position: relative;
  height: 100%;
}

/* ---- 品牌头部（上部位，水平居中）---- */
.brand-header {
  position: absolute;
  top: 9vh;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.logo {
  width: clamp(64px, 8vw, 120px);
  height: auto;
  object-fit: contain;
}
.tournament-name {
  font-size: clamp(22px, 3vw, 48px);
  font-weight: 900;
  letter-spacing: 3px;
  margin: 0;
  text-align: center;
  max-width: 80vw;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.phase {
  font-size: clamp(13px, 1.5vw, 22px);
  color: var(--syn-cyan);
  font-weight: 700;
  letter-spacing: 1px;
}

/* ---- 中央显示（绝对居中，双行双语）---- */
.center-block {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2.2vh;
}
.center-main {
  text-align: center;
  letter-spacing: 2px;
  line-height: 1.15;
  /* 默认 Coming Soon 用品牌金 */
  color: #f0a020;
  text-shadow:
    0 0 30px rgba(240, 160, 32, 0.5),
    0 4px 0 rgba(0, 0, 0, 0.4);
  transition: color 0.3s, text-shadow 0.3s;
}
.center-main .zh {
  font-size: clamp(44px, 8vw, 130px);
  font-weight: 900;
}
.center-main .en {
  font-size: clamp(20px, 3vw, 48px);
  font-weight: 800;
  opacity: 0.92;
  letter-spacing: 4px;
}
.center-main.counting {
  font-size: clamp(48px, 10vw, 160px);
  font-weight: 900;
  color: #fff;
  text-shadow:
    0 0 40px rgba(255, 255, 255, 0.6),
    0 0 80px rgba(96, 220, 255, 0.4),
    0 6px 0 rgba(0, 0, 0, 0.4);
}
.center-main.finished {
  color: #37d27a;
  text-shadow:
    0 0 40px rgba(55, 210, 122, 0.6),
    0 6px 0 rgba(0, 0, 0, 0.4);
  animation: pulse-finish 1.2s ease-in-out infinite;
}
@keyframes pulse-finish {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.04); }
}
.status-label {
  font-size: clamp(13px, 1.4vw, 20px);
  letter-spacing: 1px;
}
</style>

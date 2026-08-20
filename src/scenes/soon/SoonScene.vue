<script setup lang="ts">
/**
 * Coming Soon / 倒计时背景场景。
 *
 * 合成器浪潮背景之上：
 *   中上：品牌 logo + 赛事名 + 阶段状态
 *   屏幕中央："Coming Soon..." 或倒计时数字（由导播控制台通过 localStorage 操控）
 *
 * 数据来源：director store（hosted 模式下由舞台根统一连 WS，本组件只读）。
 * 倒计时状态：localStorage key `twc-soon-countdown`，格式：
 *   { targetMs: number, startedAt: number | null, pausedAt: number | null }
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useDirectorStore } from "@/stores/director";
import { phaseInfo } from "@/utils/format";
import { useSceneContext } from "@/scenes/composables/useSceneContext";

const { t } = useI18n();
const director = useDirectorStore();
const { sharedBg } = useSceneContext();

/** 品牌默认 logo（统一位置 public/logo.png） */
const DEFAULT_LOGO = "/logo.png";

// ---- 赛事信息（显示赛事名，非单场比赛名；BO 是单场的，这里不展示）----
const tournamentName = computed(() => director.matchName || t("soon.noMatch"));
const phaseLabel = computed(() => phaseInfo(director.phase).label);

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

/** 中央显示文字 */
const centerText = computed(() => {
  const s = soonState.value;
  if (s.startedAt === null) return t("soon.comingSoon");
  if (isFinished.value) return t("soon.finished");
  return fmt(remainingMs.value);
});

/** 状态标签文字（给控制台参考，本场景内也可展示小字） */
const statusTag = computed(() => {
  const s = soonState.value;
  if (s.startedAt === null) return t("directorView.soonIdle");
  if (s.pausedAt !== null) return t("directorView.soonPaused");
  if (isFinished.value) return t("directorView.soonFinished");
  return t("directorView.soonRunning");
});

function tick(): void {
  remainingMs.value = calcRemaining();
}

onMounted(() => {
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
      <!-- 全部内容屏幕正中央 -->
      <main class="center-display">
        <!-- 品牌：logo + 赛事名 + 状态 -->
        <header class="brand-header">
          <img :src="DEFAULT_LOGO" class="logo" alt="logo" />
          <h1 class="tournament-name neon-text">{{ tournamentName }}</h1>
          <span class="phase neon-text-cyan">{{ phaseLabel }}</span>
        </header>

        <!-- Coming Soon / 倒计时 -->
        <div class="center-main" :class="{ counting: soonState.startedAt !== null && !isFinished, finished: isFinished }">
          {{ centerText }}
        </div>
        <div v-if="soonState.startedAt !== null" class="status-label neon-text-dim">
          {{ statusTag }}
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
.soon-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 4vh 4vw;
}

/* ---- 全部居中 ---- */
.center-display {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

/* ---- 品牌头部（居中）---- */
.brand-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
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
}
.phase {
  font-size: clamp(13px, 1.5vw, 22px);
  color: var(--syn-cyan);
  font-weight: 700;
}
.center-main {
  font-size: clamp(48px, 10vw, 160px);
  font-weight: 900;
  line-height: 1.1;
  text-align: center;
  letter-spacing: 2px;
  /* 默认 Coming Soon... 用品牌金 */
  color: #f0a020;
  text-shadow:
    0 0 30px rgba(240, 160, 32, 0.5),
    0 4px 0 rgba(0, 0, 0, 0.4);
  transition: color 0.3s, text-shadow 0.3s;
}
.center-main.counting {
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

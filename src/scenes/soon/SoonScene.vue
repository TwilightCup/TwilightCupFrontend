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

// ---- 赛事信息 ----
const matchName = computed(() => director.matchName || t("soon.noMatch"));
const phaseLabel = computed(() => phaseInfo(director.phase).label);
const boText = computed(() =>
  director.boFormat ? `BO${director.boFormat}` : "",
);

// ---- 倒计时状态（从 localStorage 读取，跨标签同步） ----
interface CountdownState {
  /** 目标总毫秒数 */
  targetMs: number;
  /** 开始时间戳（null = 未启动） */
  startedAt: number | null;
  /** 暂停时间戳（null = 未暂停） */
  pausedAt: number | null;
}

const COUNTDOWN_KEY = "twc-soon-countdown";

function loadState(): CountdownState {
  try {
    const raw = localStorage.getItem(COUNTDOWN_KEY);
    if (raw) return JSON.parse(raw) as CountdownState;
  } catch {
    // ignore
  }
  return { targetMs: 300_000, startedAt: null, pausedAt: null };
}

const state = ref<CountdownState>(loadState());
const remainingMs = ref(0);
let timerId: ReturnType<typeof setInterval> | null = null;

/** 计算剩余毫秒数 */
function calcRemaining(): number {
  const s = state.value;
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
const isFinished = computed(() => remainingMs.value <= 0 && state.value.startedAt !== null);

/** 格式化 mm:ss */
function fmt(ms: number): string {
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** 中央显示文字 */
const centerText = computed(() => {
  if (state.value.startedAt === null) return t("soon.comingSoon");
  if (isFinished.value) return t("soon.finished");
  return fmt(remainingMs.value);
});

/** 状态标签文字（给控制台参考，本场景内也可展示小字） */
const statusTag = computed(() => {
  if (state.value.startedAt === null) return t("directorView.soonIdle");
  if (state.value.pausedAt !== null) return t("directorView.soonPaused");
  if (isFinished.value) return t("directorView.soonFinished");
  return t("directorView.soonRunning");
});

function tick(): void {
  remainingMs.value = calcRemaining();
}

let storageCleanup: (() => void) | null = null;

onMounted(() => {
  // 监听 localStorage 变化（控制台写 → 本标签即时响应）
  const onStorage = (e: StorageEvent): void => {
    if (e.key === COUNTDOWN_KEY && e.newValue) {
      try {
        state.value = JSON.parse(e.newValue) as CountdownState;
        tick();
      } catch {
        // ignore
      }
    }
  };
  window.addEventListener("storage", onStorage);
  storageCleanup = () => window.removeEventListener("storage", onStorage);

  tick();
  timerId = setInterval(tick, 200); // 200ms 刷新够平滑
});

onUnmounted(() => {
  storageCleanup?.();
  if (timerId) clearInterval(timerId);
});
</script>

<template>
  <div class="scene scanlines">
    <SynthwaveBg v-if="!sharedBg" />

    <div class="content soon-content">
      <!-- 中上：品牌区 -->
      <header class="brand-header">
        <img :src="DEFAULT_LOGO" class="logo" alt="logo" />
        <h1 class="match-name neon-text">{{ matchName }}</h1>
        <div class="meta-row">
          <span v-if="boText" class="bo neon-text-dim">{{ boText }}</span>
          <span class="phase neon-text-cyan">{{ phaseLabel }}</span>
        </div>
      </header>

      <!-- 中央：Coming Soon / 倒计时 -->
      <main class="center-display">
        <div class="center-main" :class="{ counting: state.startedAt !== null && !isFinished, finished: isFinished }">
          {{ centerText }}
        </div>
        <div v-if="state.startedAt !== null" class="status-label neon-text-dim">
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

/* ---- 品牌头部 ---- */
.brand-header {
  position: absolute;
  top: 5vh;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.logo {
  width: clamp(56px, 7vw, 110px);
  height: auto;
  object-fit: contain;
}
.match-name {
  font-size: clamp(20px, 2.8vw, 42px);
  font-weight: 900;
  letter-spacing: 2px;
  margin: 0;
  text-align: center;
}
.meta-row {
  display: flex;
  gap: 12px;
  font-size: clamp(12px, 1.2vw, 18px);
}
.bo {
  color: var(--syn-text-dim);
}
.phase {
  color: var(--syn-cyan);
  font-weight: 700;
}

/* ---- 中央显示 ---- */
.center-display {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
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

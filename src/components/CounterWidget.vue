<script setup lang="ts">
import { onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { ElMessage } from "element-plus";
import { useMatchStore } from "@/stores/match";

const { t } = useI18n();
const match = useMatchStore();

const disp = ref<number | null>(null);
const seconds = ref(60);
let timer: ReturnType<typeof setInterval> | null = null;

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${String(ss).padStart(2, "0")}`;
}

function stopTick(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
function startTick(): void {
  stopTick();
  timer = setInterval(() => {
    if (disp.value !== null && disp.value > 0) disp.value -= 1;
  }, 1000);
}

watch(
  () => match.counterRemaining,
  (v) => {
    if (v === null) {
      disp.value = null;
      stopTick();
    } else {
      // 以服务端里程碑校正本地计时
      disp.value = v;
      if (!timer) startTick();
    }
  },
)

function start(): void {
  if (seconds.value <= 0) {
    ElMessage.warning(t("counter.secondsPositive"));
    return;
  }
  match.runCommand(`!timer ${seconds.value}`);
  // 乐观刷新：覆盖旧计时器时服务端 counter_state 的 remaining 可能与上一里程碑
  // 相同（watch 不触发），故本地立即按新秒数重置并重启 tick，随后由服务端校正。
  disp.value = seconds.value;
  startTick();
}
function reset(): void {
  match.runCommand("!timer reset");
  // 同理，乐观清空，避免依赖 counter_state(null) 触发 watch。
  disp.value = null;
  stopTick();
}

onUnmounted(stopTick);
</script>

<template>
  <section class="counter">
    <div class="title">{{ $t('counter.title') }} <span class="hint">!timer</span></div>
    <div class="display" :class="{ active: disp !== null }">
      {{ disp !== null ? fmt(disp) : "--:--" }}
    </div>
    <div class="controls">
      <el-input-number v-model="seconds" :min="1" :max="3600" :step="10" size="small" />
      <el-button size="small" type="primary" @click="start">{{ $t('counter.startBtn') }}</el-button>
      <el-button size="small" @click="reset">{{ $t('counter.resetBtn') }}</el-button>
    </div>
    <p class="tip">{{ $t('counter.disclaimer') }}</p>
  </section>
</template>

<style scoped>
.counter {
  background: var(--tc-bg-soft);
  border: 1px solid var(--tc-border);
  border-radius: 10px;
  padding: 12px 14px;
}
.title {
  font-size: 13px;
  font-weight: 600;
  color: var(--tc-text-dim);
  display: flex;
  align-items: center;
  gap: 6px;
}
.hint {
  font-size: 11px;
  color: var(--tc-text-dim);
  background: var(--tc-hover);
  padding: 1px 6px;
  border-radius: 4px;
}
.display {
  font-size: 38px;
  font-weight: 800;
  text-align: center;
  margin: 6px 0;
  color: var(--tc-text-dim);
  font-variant-numeric: tabular-nums;
}
.display.active {
  color: var(--tc-primary);
}
.controls {
  display: flex;
  gap: 6px;
  align-items: center;
  justify-content: center;
}
.tip {
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--tc-text-dim);
  text-align: center;
}
</style>

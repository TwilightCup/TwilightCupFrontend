<script setup lang="ts">
/**
 * 对齐渲染展示层（canvas）——不做独立解码/独立对齐，只消费单一权威 alignEngine 的
 * 帧（舞台 A/B 与控制台 A/B 同 T 同帧，像素一致，§1.2）。能力不可用(off) → 序言占位，
 * 由父组件据 modeOf 切回 StreamFrame(MSE) 兜底。
 *
 * side='A' 蓝（左）、'B' 红（右）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { bi } from "@/utils/bilingual";
import { alignEngine, type Side } from "@/scenes/align/useFrameAlign";

const props = withDefaults(
  defineProps<{
    side: Side;
    /** 该侧对齐流 URL（m3u8）；空则不启动 */
    url: string;
    /** 对齐开关（配置 alignA/B）；关 → 父组件换 StreamFrame */
    enabled: boolean;
    /** 是否按 4:3 裁切（导播端 true；裁判端 false 按原 16:9） */
    crop4to3?: boolean;
    /** 隐藏（等待信号占位；应急） */
    hidden?: boolean;
  }>(),
  { crop4to3: true, hidden: false },
);

const cv = ref<HTMLCanvasElement | null>(null);
const aligned = ref(false);
/** 本侧拉流错误（可读文案；无则 null）。来自 alignEngine.streamError（响应式） */
const pullErr = computed(() => alignEngine.streamError[props.side]);

function refresh(): void {
  if (props.enabled && props.url) {
    alignEngine.startStream(props.side, props.url);
    if (!aligned.value) aligned.value = alignEngine.modeOf(props.side) === "aligned";
  }
}

onMounted(() => {
  refresh();            // 启动本侧权威流 + 定 aligned
  alignEngine.start();  // 确保主循环运行（幂等）
});

let unreg: (() => void) | null = null;
onBeforeUnmount(() => {
  unreg?.();
  if (props.enabled && props.url) alignEngine.stopStream(props.side);
});

// 监听本侧对齐能力变化（初始化异步探测后模式可能翻转为 aligned）
watch(
  () => props.enabled && props.url && alignEngine.modeOf(props.side),
  (m) => { aligned.value = m === "aligned"; },
);

// canvas 元素随 aligned 出现/消失 → 注册/注销到权威（同一侧可多 canvas）
watch(cv, (c) => {
  unreg?.();
  unreg = c ? alignEngine.registerCanvas(props.side, c) : null;
}, { flush: "post" });
</script>

<template>
  <div class="frame" :class="[side, { uncropped: !props.crop4to3 }]">
    <canvas
      v-if="aligned && !props.hidden"
      ref="cv"
      class="video"
    />
    <div v-else class="placeholder">
      <div v-if="pullErr" class="err">⚠ 拉不到流 · {{ pullErr }}</div>
      <div v-else class="live">● {{ bi("scenes.match.waitingSignal") }}</div>
      <div v-if="props.url" class="url">{{ props.url }}</div>
    </div>
  </div>
</template>

<style scoped>
.frame {
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  background: #050010;
}
.frame.uncropped { aspect-ratio: 16 / 9; }
canvas.video {
  width: 100%;
  height: 100%;
  display: block;
  /* object-fit 裁切由 canvas 内容在引擎内已按全幅绘制；此处保持铺满 */
  background: #000;
}
.frame.uncropped canvas.video { object-fit: contain; }
.placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: linear-gradient(135deg, #1a0633, #2d0b4e, #1a0633);
  background-size: 200% 200%;
  animation: shift 6s ease infinite;
}
.live {
  font-size: clamp(12px, 1.4vw, 20px);
  font-weight: 800;
  color: var(--syn-magenta);
  animation: blink 1.4s steps(2) infinite;
  z-index: 1;
}
.err {
  z-index: 1;
  font-size: clamp(13px, 1.5vw, 22px);
  font-weight: 800;
  color: var(--syn-a-warm, #ffb0a0);
  text-align: center;
  max-width: 92%;
  line-height: 1.4;
}
.url { z-index: 1; font-size: clamp(9px, 0.9vw, 13px); color: var(--syn-text-dim); }
@keyframes shift { 0%, 100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
@keyframes blink { 50% { opacity: 0.45; } }
</style>
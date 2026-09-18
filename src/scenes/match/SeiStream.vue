<script setup lang="ts">
/**
 * 对齐渲染展示层（canvas）——不做独立解码/独立对齐，只消费单一权威 alignEngine 的
 * 帧（舞台 A/B 与控制台 A/B 同 T 同帧，像素一致，§1.2）。能力不可用(off) → 序言占位，
 * 由父组件据 modeOf 切回 StreamFrame(MSE) 兜底。
 *
 * side='A' 蓝（左）、'B' 红（右）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { usePanelVisibility } from "@/scenes/composables/usePanelVisibility";
import { streamWaitingText } from "@/scenes/align/streamStatus";
import { bi } from "@/utils/bilingual";
import { alignEngine, type Side } from "@/scenes/align/useFrameAlign";

const props = withDefaults(
  defineProps<{
    side: Side;
    /** Director-only output budget; standalone stage remains full resolution. */
    previewWidth?: number;
    previewHeight?: number;
    /** 该侧对齐流 URL（m3u8）；空则不启动 */
    url: string;
    /** 对齐开关（配置 alignA/B）；关 → 父组件换 StreamFrame */
    enabled: boolean;
    refreshNonce?: number;
    /** 是否按 4:3 裁切（导播端 true；裁判端 false 按原 16:9） */
    crop4to3?: boolean;
    /** 隐藏（等待信号占位；应急） */
    hidden?: boolean;
    /** 裸模式（舞台对外播出用）：任何情况只显示扫描器式"等待信号"，不写错误码/解码/地址 */
    bare?: boolean;
  }>(),
  { crop4to3: true, hidden: false, bare: false },
);

const cv = ref<HTMLCanvasElement | null>(null);
const panelVisible = props.previewWidth ? usePanelVisibility(cv) : null;
const aligned = ref(false);
/** 本侧拉流错误（可读文案；无则 null）。来自 alignEngine.streamError（响应式） */
const pullErr = computed(() => alignEngine.streamError[props.side]);
/** 本侧是否已解析出 SEI 帧（区分"在解码"与"待解码/不支持"） */
const frameCount = computed(() => alignEngine.health[props.side].frames);
const waitingText = computed(() => streamWaitingText({ frames: frameCount.value,
  candidate: alignEngine.sync.candidate, publisher: alignEngine.sync.role === "publisher", authorityUs: alignEngine.sync.authorityUs, state: alignEngine.sync.state, aligned: aligned.value }));
/** 本侧解码错误（WebCodecs 实际报错，明文） */
const decodeErr = computed(() => alignEngine.health[props.side].decodeError);
/** 本侧是否已真正上屏过一帧（用于决定舞台显示等待信号还是画面） */
// Canvas pixels outlive VideoFrames. Readiness may fall without erasing the last image.
const signalWaiting = computed(() => alignEngine.sync.waitingSides.includes(props.side));
const hasImage = computed(() => !signalWaiting.value && alignEngine.hasCanvasImage(cv.value));

let release: (() => void) | null = null;
function refresh(): void {
  if (props.enabled && props.url) {
    release = alignEngine.startStream(props.side, props.url);
    aligned.value = alignEngine.modeOf(props.side) === "aligned";
  }
}
onMounted(() => { refresh(); alignEngine.start(); });
watch(() => props.url, () => {
  release?.();
  release = null;
  refresh();
});
watch(() => props.refreshNonce, () => alignEngine.restartStream(props.side));
let unreg: (() => void) | null = null;
onBeforeUnmount(() => {
  unreg?.();
  release?.();
});

// 监听本侧对齐能力变化（isConfigSupported 异步探测后 mode 会翻转为 aligned）。
// 必须 watch 响应式的 alignEngine.modes[side]，否则翻转不会触发（之前 watch modeOf 非响应式，
// 导致模式转 aligned 后这里不重跑 → 永远占位"等待信号"）。
watch(
  () => alignEngine.modes[props.side],
  (m) => { aligned.value = m === "aligned"; },
);

// canvas 元素随 aligned 出现/消失 → 注册/注销到权威（同一侧可多 canvas）
watch(cv, (c) => {
  unreg?.();
  unreg = c ? alignEngine.registerCanvas(props.side, c, props.previewWidth ? {
    maxWidth: props.previewWidth, maxHeight: props.previewHeight ?? 360,
    visible: () => panelVisible?.value ?? false,
  } : undefined) : null;
}, { flush: "post" });
</script>

<template>
  <div class="frame" :class="[side, { uncropped: !props.crop4to3 }]">
    <div v-if="!props.hidden" class="stage">
      <canvas ref="cv" class="video" />
      <!-- 舞台在真正出画面(已上屏)前一律显示等待信号 Awaiting；不显示"攒缓冲中/已就绪"这类对齐相位 -->
      <div v-if="!hasImage" class="ph-abs">
        <!-- bare(舞台)：任何情况下只露扫描器式等待，错误码/解码/地址一律不写 -->
        <template v-if="bare || signalWaiting">
          <div class="live">● {{ bi("scenes.match.waitingSignal") }}</div>
        </template>
        <template v-else>
          <div v-if="pullErr" class="err">⚠ 拉不到流 · {{ pullErr }}</div>
          <div v-else-if="decodeErr" class="err">解码出错 · {{ decodeErr }}</div>
          <div v-else class="live">{{ waitingText }}</div>
        </template>
      </div>
    </div>
    <div v-else class="placeholder">
      <template v-if="bare || signalWaiting">
        <div class="live">● {{ bi("scenes.match.waitingSignal") }}</div>
      </template>
      <template v-else>
        <div v-if="pullErr" class="err">⚠ 拉不到流 · {{ pullErr }}</div>
        <div v-else-if="decodeErr" class="err">解码出错 · {{ decodeErr }}</div>
        <div v-else-if="frameCount > 0" class="live">{{ waitingText }}</div>
        <div v-else class="live">● {{ bi("scenes.match.waitingSignal") }}</div>
      </template>
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
.stage {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #000;
}
canvas.video {
  display: block;
  width: 100%;
  height: 100%;
  background: #000;
  /* 原生分辨率 canvas → cover 裁切（高铺满、左右居中裁） */
  object-fit: cover;
}
/* 舞台在未上屏前叠加的等待信号层 */
.ph-abs {
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
.ph-abs .live,
.ph-abs .err {
  z-index: 1;
}
/* 扫描线：与 StreamFrame 占位同款，恢复原有风格；压在对齐文字之上（字被扫过） */
.ph-abs::after,
.placeholder::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 3;
  background: repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.18) 0 1px, transparent 1px 3px);
  pointer-events: none;
}
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
@keyframes shift { 0%, 100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
@keyframes blink { 50% { opacity: 0.45; } }
</style>
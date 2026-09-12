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
/** 本侧是否已解析出 SEI 帧（区分"在解码"与"待解码/不支持"） */
const hasFrames = computed(() => alignEngine.health[props.side].frames > 0);
/** 本侧解码错误（WebCodecs 实际报错，明文） */
const decodeErr = computed(() => alignEngine.health[props.side].decodeError);
/** 本侧是否已真正上屏过一帧（攒够约 30s 缓冲后才 True） */
const presented = computed(() => alignEngine.presented[props.side]);
/** 刚就绪的短暂"✓ 已就绪"提示（约 3s 后消失） */
const readyFlash = ref(false);
watch(presented, (p) => {
  if (p) {
    readyFlash.value = true;
    setTimeout(() => { readyFlash.value = false; }, 3000);
  }
});

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
  unreg = c ? alignEngine.registerCanvas(props.side, c) : null;
}, { flush: "post" });
</script>

<template>
  <div class="frame" :class="[side, { uncropped: !props.crop4to3 }]">
    <div v-if="aligned && !props.hidden" class="stage">
      <canvas ref="cv" class="video" />
      <div v-if="!presented" class="phase">⏳ 攒缓冲中（需约 30s）…</div>
      <div v-else-if="readyFlash" class="phase ok">✓ 已就绪</div>
    </div>
    <div v-else class="placeholder">
      <div v-if="pullErr" class="err">⚠ 拉不到流 · {{ pullErr }}</div>
      <div v-else-if="decodeErr" class="err">解码出错 · {{ decodeErr }}</div>
      <div v-else-if="hasFrames" class="err">画面已解析 {{ hasFrames }} 帧，但解码未就绪 / 环境不支持 WebCodecs</div>
      <div v-else class="live">● {{ bi("scenes.match.waitingSignal") }}</div>
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
}
canvas.video {
  width: 100%;
  height: 100%;
  display: block;
  /* object-fit 裁切由 canvas 内容在引擎内已按全幅绘制；此处保持铺满 */
  background: #000;
}
.frame.uncropped canvas.video { object-fit: contain; }
.phase {
  position: absolute;
  inset: auto 0 8% 0;
  margin: 0 auto;
  width: max-content;
  max-width: 92%;
  padding: 6px 14px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: clamp(12px, 1.3vw, 18px);
  font-weight: 700;
  text-align: center;
  z-index: 3;
  pointer-events: none;
}
.phase.ok { color: #37d67a; }
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
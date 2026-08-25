<script setup lang="ts">
/**
 * 选手直播卡（4:3）。16:9 推流经 object-fit:cover 居中裁去左右两侧，铺满卡片。
 *
 * 播放优先级：HLS（自有流媒体服务器输出）> 外部嵌入（B站/YouTube）> 占位。
 * - HLS：Safari/原生支持则 <video src> 直放；其余（Chrome/Edge/OBS CEF）
 *   动态 import hls.js 走 MSE 解码——OBS 浏览器源实为 Chromium，靠这条播放。
 * - 嵌入：配置 embedUrl（可 iframe 的嵌入播放器地址）时整卡 <iframe> 渲染。
 *
 * side='A' 蓝（左）、'B' 红（右）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type HlsClass from "hls.js";
import { bi } from "@/utils/bilingual";

const props = defineProps<{
  side: "A" | "B";
  hlsUrl: string;
  embedUrl?: string;
}>();

/** HLS 播放失败（MSE 不可用 / 致命解码错误）→ 降级：嵌入 → 占位（可见，不黑屏） */
const videoBroken = ref(false);

/** 展示模式：HLS 视频优先，其次外部嵌入，都无（或 HLS 已坏）则占位 */
const mode = computed<"video" | "embed" | "none">(() => {
  if (props.hlsUrl && !videoBroken.value) return "video";
  if (props.embedUrl) return "embed";
  return "none";
});

const videoEl = ref<HTMLVideoElement | null>(null);
let hls: HlsClass | null = null;

/** 原生 HLS 支持（Safari 系） */
function nativeHls(v: HTMLVideoElement): boolean {
  return !!v.canPlayType("application/vnd.apple.mpegurl");
}

/** 挂载/换源：按浏览器能力走原生或 hls.js（动态加载，不拖累首屏） */
async function attach(): Promise<void> {
  const v = videoEl.value;
  destroyHls();
  videoBroken.value = false;
  if (!v || !props.hlsUrl) return;
  if (nativeHls(v)) {
    v.src = props.hlsUrl;
    void v.play().catch(() => {/* muted autoplay 被拦时静默，画面仍渲染 */});
    return;
  }
  try {
    const { default: Hls } = await import("hls.js");
    if (videoEl.value !== v) return; // 等待期间已换卡/卸载
    if (!Hls.isSupported()) {
      videoBroken.value = true; // 理论上 OBS/Chrome 均支持；真不支持时可见降级
      return;
    }
    destroyHls();
    hls = new Hls({
      enableWorker: true,
      lowLatencyMode: true, // LL-HLS 源自动低延迟；普通 HLS 不受影响
      liveDurationInfinity: true, // 直播不显示总时长，避免 seek 条异常
      maxBufferLength: 10, // 小缓冲降低直播延迟
    });
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (data.fatal) {
        videoBroken.value = true; // 致命错误（404/解码失败…）→ 可见降级不黑屏
        destroyHls();
      }
    });
    hls.loadSource(props.hlsUrl);
    hls.attachMedia(v);
  } catch {
    videoBroken.value = true;
  }
}

function destroyHls(): void {
  if (hls) {
    hls.destroy();
    hls = null;
  }
}

onMounted(() => void attach());
watch(() => [props.hlsUrl, mode.value], () => void attach());
onBeforeUnmount(() => {
  destroyHls();
  const v = videoEl.value;
  if (v) v.src = "";
});
</script>

<template>
  <div class="frame" :class="side">
    <!-- 方案②：外部直播嵌入（B站/YouTube 播放器 iframe） -->
    <iframe
      v-if="mode === 'embed'"
      :src="embedUrl"
      class="video"
      allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
      allowfullscreen
      frameborder="0"
      referrerpolicy="no-referrer-when-downgrade"
    />
    <!-- 方案①：自有服务器 HLS（Safari 原生 / 其余 hls.js） -->
    <video
      v-else-if="mode === 'video'"
      ref="videoEl"
      autoplay
      muted
      playsinline
      class="video"
    />
    <!-- 未推流 / HLS 播放失败：占位（可见降级，不黑屏） -->
    <div v-else class="placeholder">
      <div class="live">● {{ bi("scenes.match.waitingSignal") }}</div>
      <div v-if="videoBroken && hlsUrl" class="url">{{ hlsUrl }}</div>
    </div>
  </div>
</template>

<style scoped>
/* 双卡各占半宽无缝拼成 8:3，满铺 1920px（外层 .streams 控制） */
.frame {
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  background: #050010;
}
.video {
  width: 100%;
  height: 100%;
  object-fit: cover; /* 16:9 → 4:3：裁去左右 */
  background: #000;
  border: 0;
  display: block;
}
/* 占位：动画渐变 + 扫描线 + 主题色内边框（推流后不渲染，画面完整覆盖） */
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
.placeholder::after {
  content: "";
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(
    0deg,
    rgba(0, 0, 0, 0.18) 0 1px,
    transparent 1px 3px
  );
  pointer-events: none;
}
.frame.A .placeholder {
  box-shadow: inset 0 0 0 3px var(--syn-a), inset 0 0 24px rgba(61, 139, 255, 0.25);
}
.frame.B .placeholder {
  box-shadow: inset 0 0 0 3px var(--syn-b), inset 0 0 24px rgba(255, 107, 74, 0.25);
}
.live {
  font-size: clamp(12px, 1.4vw, 20px);
  font-weight: 800;
  color: var(--syn-magenta);
  letter-spacing: 1px;
  animation: blink 1.4s steps(2) infinite;
  z-index: 1;
}
.url {
  z-index: 1;
  font-family: monospace;
  font-size: clamp(9px, 0.9vw, 13px);
  color: var(--syn-text-dim);
  max-width: 90%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@keyframes shift {
  0%, 100% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
}
@keyframes blink {
  50% { opacity: 0.45; }
}
</style>

<script setup lang="ts">
/**
 * 选手直播卡（4:3）。16:9 推流经 object-fit:cover 居中裁去左右两侧，铺满卡片。
 *
 * 播放优先级：HLS（自有流媒体服务器输出）> YouTube/B站代理流 > 外部嵌入 > 占位。
 * - HLS：Safari/原生支持则 <video src> 直放；其余（Chrome/Edge/OBS CEF）
 *   动态 import hls.js 走 MSE 解码。
 * - B站：不再 iframe 嵌入（blanc 页会被 Chrome Local Network Access 拦截），
 *   而是走后端同源代理，用 mpegts.js 播放 HTTP-FLV（参考 BililiveRecorder
 *   的取流和播放方式）。
 * - YouTube：不再 iframe 嵌入（embed 页仍会触发 Chrome Local Network Access
 *   拦截），而是走后端同源 HLS 代理，用 hls.js 播放（参考 B站代理流思路）。
 * - 其它外部站点仍走 iframe；object-fit 不适用，用 16:9 定宽外溢 +
 *   overflow:hidden 裁左右（与 <video> 的 cover 裁切同口径）。
 *
 * side='A' 蓝（左）、'B' 红（右）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type HlsClass from "hls.js";
import { bi } from "@/utils/bilingual";
import { parseBilibiliLiveRoomId } from "@/utils/bilibili";
import { parseYouTubeVideoId, toYouTubeEmbedUrl } from "@/utils/youtube";
import { bilibiliStreamUrl } from "@/api/bilibili";
import { youtubeStreamUrl } from "@/api/youtube";

interface MpegtsPlayer {
  attachMediaElement(el: HTMLVideoElement): void;
  load(): void;
  play?(): Promise<void> | void;
  destroy(): void;
  on(event: string, callback: (data: unknown) => void): void;
}

interface MpegtsModule {
  isSupported(): boolean;
  createPlayer(
    opts: Record<string, unknown>,
    config?: Record<string, unknown>,
  ): MpegtsPlayer;
  Events?: Record<string, string>;
}

declare global {
  interface Window {
    mpegts?: MpegtsModule;
  }
}

const props = defineProps<{
  side: "A" | "B";
  hlsUrl: string;
  embedUrl?: string;
  /** 当前导播/裁判/管理 JWT（YouTube/B站代理流地址需要；场景页传 URL token） */
  token?: string;
  /** 隐藏该侧画面（等待信号占位；应急开关，控制台经 config_update 广播） */
  hidden?: boolean;
  /** 重新拉流计数（变化即重挂播放器：卡顿应急刷新） */
  refreshNonce?: number;
}>();

/** HLS/B站流播放失败（MSE 不可用 / 致命解码错误）→ 占位（可见，不黑屏） */
const videoBroken = ref(false);

/** 展示模式：被隐藏直接占位；HLS 视频优先，其次 YouTube/B站代理流，再其次外部嵌入 */
const mode = computed<"video" | "yt" | "bili" | "embed" | "none">(() => {
  if (props.hidden) return "none";
  if (props.hlsUrl && !videoBroken.value) return "video";
  if (props.embedUrl && parseYouTubeVideoId(props.embedUrl)) return "yt";
  if (props.embedUrl && parseBilibiliLiveRoomId(props.embedUrl)) return "bili";
  if (props.embedUrl) return "embed";
  return "none";
});

/** YouTube 视频 ID（同源代理流用） */
const youtubeId = computed(() => parseYouTubeVideoId(props.embedUrl ?? ""));
/** YouTube 同源 HLS 代理流地址 */
const youtubeSrc = computed(() =>
  youtubeId.value ? youtubeStreamUrl(youtubeId.value, props.token) : "",
);

/** 外部嵌入地址：其它站点 iframe 时使用，YouTube 已改走同源代理 */
const embedSrc = computed(() => toYouTubeEmbedUrl(props.embedUrl ?? ""));

const videoEl = ref<HTMLVideoElement | null>(null);
let hls: HlsClass | null = null;
let mpegtsPlayer: MpegtsPlayer | null = null;
let mpegtsPromise: Promise<MpegtsModule> | null = null;

/** 原生 HLS 支持（Safari 系） */
function nativeHls(v: HTMLVideoElement): boolean {
  return !!v.canPlayType("application/vnd.apple.mpegurl");
}

/** 动态加载 mpegts.js（从 public/vendor 提供，避免拖累首屏） */
function loadMpegts(): Promise<MpegtsModule> {
  if (window.mpegts) return Promise.resolve(window.mpegts);
  if (mpegtsPromise) return mpegtsPromise;
  mpegtsPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `${import.meta.env.BASE_URL}vendor/mpegts.js`;
    s.onload = () => {
      if (window.mpegts) {
        resolve(window.mpegts);
      } else {
        mpegtsPromise = null;
        reject(new Error("mpegts.js loaded but global missing"));
      }
    };
    s.onerror = () => {
      mpegtsPromise = null;
      reject(new Error("mpegts.js load failed"));
    };
    document.head.appendChild(s);
  });
  return mpegtsPromise;
}

function destroyHls(): void {
  if (hls) {
    hls.destroy();
    hls = null;
  }
}

function destroyMpegts(): void {
  if (mpegtsPlayer) {
    mpegtsPlayer.destroy();
    mpegtsPlayer = null;
  }
}

/** 挂载/换源：HLS、YouTube/B站代理流或外部 iframe 由 mode 决定，只处理 video 类 */
async function attach(): Promise<void> {
  const v = videoEl.value;
  destroyHls();
  destroyMpegts();
  videoBroken.value = false;
  if (props.hidden) return;
  if (!v) return;

  // 方案①：自有服务器 HLS
  if (props.hlsUrl) {
    if (nativeHls(v)) {
      v.src = props.hlsUrl;
      void v.play().catch(() => {/* muted autoplay 被拦时静默，画面仍渲染 */});
      return;
    }
    try {
      const { default: Hls } = await import("hls.js");
      if (videoEl.value !== v) return; // 等待期间已换卡/卸载
      if (!Hls.isSupported()) {
        videoBroken.value = true;
        return;
      }
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        liveDurationInfinity: true,
        maxBufferLength: 10,
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          videoBroken.value = true;
          destroyHls();
        }
      });
      hls.loadSource(props.hlsUrl);
      hls.attachMedia(v);
    } catch {
      videoBroken.value = true;
    }
    return;
  }

  // 方案②：YouTube 直播同源 HLS 代理（hls.js）
  const ytId = youtubeId.value;
  if (ytId) {
    try {
      const { default: Hls } = await import("hls.js");
      if (videoEl.value !== v) return;
      if (!Hls.isSupported()) {
        videoBroken.value = true;
        return;
      }
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        liveDurationInfinity: true,
        maxBufferLength: 10,
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          videoBroken.value = true;
          destroyHls();
        }
      });
      hls.loadSource(youtubeSrc.value);
      hls.attachMedia(v);
    } catch {
      videoBroken.value = true;
    }
    return;
  }

  // 方案③：B站直播同源代理 FLV（mpegts.js）
  const roomId = parseBilibiliLiveRoomId(props.embedUrl ?? "");
  if (!roomId) return;
  try {
    const Mpegts = await loadMpegts();
    if (videoEl.value !== v) return;
    if (!Mpegts.isSupported()) {
      videoBroken.value = true;
      return;
    }
    mpegtsPlayer = Mpegts.createPlayer(
      {
        type: "flv",
        url: bilibiliStreamUrl(roomId, props.token),
        isLive: true,
      },
      {
        enableStashBuffer: false,
        liveBufferLatencyChasing: true,
        liveBufferLatencyMaxLatency: 1.5,
      },
    );
    mpegtsPlayer.on(Mpegts.Events?.ERROR ?? "error", () => {
      videoBroken.value = true;
      destroyMpegts();
    });
    mpegtsPlayer.attachMediaElement(v);
    mpegtsPlayer.load();
    // play 返回 void | Promise<void>（mpegts 类型定义），统一包 Promise 再吞异常
    if (mpegtsPlayer.play) void Promise.resolve(mpegtsPlayer.play()).catch(() => {});
  } catch {
    videoBroken.value = true;
  }
}

onMounted(() => void attach());
// flush:"post"：hlsUrl/embedUrl 在挂载后才到达（配置异步加载/config_update 广播）时，
// mode 先翻转渲染出 <video>、DOM 就绪后再挂流——默认 pre-flush 此刻 videoEl
// 尚未插入，attach 会空手而归且不再重试，画面永久黑屏。
// refreshNonce 变化 = 应急重拉流（重挂播放器）；hidden 翻转回来同理需重挂。
watch(
  () => [props.hlsUrl, props.embedUrl, props.token, props.refreshNonce, props.hidden],
  () => void attach(),
  { flush: "post" },
);
onBeforeUnmount(() => {
  destroyHls();
  destroyMpegts();
  const v = videoEl.value;
  if (v) v.src = "";
});
</script>

<template>
  <div class="frame" :class="side">
    <!-- 其它外部站点嵌入（YouTube/B站已改走同源代理，不走 iframe） -->
    <iframe
      v-if="mode === 'embed'"
      :key="refreshNonce ?? 0"
      :src="embedSrc"
      class="video"
      allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
      allowfullscreen
      frameborder="0"
      referrerpolicy="no-referrer-when-downgrade"
    />
    <!-- 自有 HLS / YouTube 代理 / B站代理 FLV：同一 video 元素，由 attach 按模式挂载 -->
    <video
      v-else-if="mode === 'video' || mode === 'yt' || mode === 'bili'"
      ref="videoEl"
      autoplay
      muted
      playsinline
      class="video"
    />
    <!-- 未推流 / 播放失败：占位（可见降级，不黑屏） -->
    <div v-else class="placeholder">
      <div class="live">● {{ bi("scenes.match.waitingSignal") }}</div>
      <div v-if="videoBroken && (hlsUrl || embedUrl)" class="url">{{ hlsUrl || embedUrl }}</div>
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
  background: #000;
  border: 0;
  display: block;
}
/* <video>：object-fit cover 裁左右（16:9 → 4:3） */
video.video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
/* <iframe>：object-fit 不生效——高度撑满卡片、宽度按 16:9 外溢（= 卡宽 ×4/3），
   居中后由 .frame 的 overflow:hidden 裁去左右，口径与 <video> 的 cover 一致 */
iframe.video {
  position: absolute;
  top: 0;
  left: 50%;
  height: 100%;
  aspect-ratio: 16 / 9;
  transform: translateX(-50%);
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
  box-shadow: inset 0 0 0 3px var(--syn-a), inset 0 0 24px var(--syn-a-glow-soft, rgba(61, 139, 255, 0.25));
}
.frame.B .placeholder {
  box-shadow: inset 0 0 0 3px var(--syn-b), inset 0 0 24px var(--syn-b-glow-soft, rgba(255, 107, 74, 0.25));
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
  font-family: "JetBrains Mono Variable", ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, monospace;
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

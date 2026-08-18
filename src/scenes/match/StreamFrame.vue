<script setup lang="ts">
/**
 * 选手直播框（4:3）。
 *
 * 浏览器不能直放 RTMP（仅 ingest）：给了转码 HLS（hlsUrl）→ <video autoplay muted> 直放
 * （Safari 原生 HLS；其余浏览器若需 hls.js 再后补，当前不引重依赖）。否则 synthwave 占位：
 * 大号选手名 + 霓虹 LIVE/等待信号 + RTMP URL 小字（供 OBS 参考）。
 *
 * side='A' 蓝（左）、'B' 红（右）。
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  side: "A" | "B";
  name: string;
  hlsUrl: string;
  rtmpUrl: string;
}>();

const { t } = useI18n();
const hasVideo = computed(() => !!props.hlsUrl);
</script>

<template>
  <div class="frame" :class="side">
    <video
      v-if="hasVideo"
      :src="hlsUrl"
      autoplay
      muted
      playsinline
      class="video"
    />
    <div v-else class="placeholder">
      <div class="live">● {{ t("scenes.match.waitingSignal") }}</div>
      <div class="pname" :class="side">{{ name }}</div>
      <div v-if="rtmpUrl" class="rtmp">{{ rtmpUrl }}</div>
      <div v-else class="rtmp dim">{{ t("scenes.match.waitingSignal") }}</div>
    </div>
  </div>
</template>

<style scoped>
.frame {
  position: relative;
  width: 100%;
  aspect-ratio: 4 / 3;
  border-radius: 14px;
  overflow: hidden;
  border: 3px solid var(--syn-border);
  background: rgba(8, 0, 20, 0.85);
  box-shadow: 0 0 30px rgba(0, 0, 0, 0.5);
}
.frame.A {
  border-color: var(--syn-a);
  box-shadow: 0 0 24px rgba(61, 139, 255, 0.35);
}
.frame.B {
  border-color: var(--syn-b);
  box-shadow: 0 0 24px rgba(255, 107, 74, 0.35);
}
.video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: #000;
}
/* 占位：动画渐变 + 扫描线 */
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
    rgba(0, 0, 0, 0.2) 0 1px,
    transparent 1px 3px
  );
  pointer-events: none;
}
@keyframes shift {
  0%, 100% { background-position: 0 0; }
  50% { background-position: 100% 100%; }
}
.live {
  font-size: clamp(12px, 1.1vw, 16px);
  font-weight: 800;
  color: var(--syn-magenta);
  letter-spacing: 1px;
  animation: blink 1.4s steps(2) infinite;
  z-index: 1;
}
@keyframes blink {
  50% { opacity: 0.4; }
}
.pname {
  font-size: clamp(22px, 3vw, 46px);
  font-weight: 900;
  z-index: 1;
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.7);
}
.pname.A {
  color: var(--syn-a);
}
.pname.B {
  color: var(--syn-b);
}
.rtmp {
  z-index: 1;
  font-family: monospace;
  font-size: clamp(9px, 0.9vw, 13px);
  color: var(--syn-text-dim);
  max-width: 90%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rtmp.dim {
  font-style: italic;
}
</style>

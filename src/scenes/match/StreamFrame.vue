<script setup lang="ts">
/**
 * 选手直播卡（4:3）。16:9 推流经 object-fit:cover 居中裁去左右两侧，铺满卡片。
 *
 * 浏览器不能直放 RTMP（仅 ingest）：给了转码 HLS（hlsUrl）→ <video autoplay muted>
 * 直放（Safari 原生 HLS；其余浏览器若需 hls.js 再后补，当前不引重依赖）。
 * 未推流：透出卡片背景（合成器动画 + 扫描线）+ 选手主题色内边框 + 等待信号 +
 * RTMP URL 小字（供 OBS 参考）；推流接入后画面完整覆盖卡片区域（无边框）。
 *
 * side='A' 蓝（左）、'B' 红（右）。
 */
import { computed } from "vue";
import { bi } from "@/utils/bilingual";

const props = defineProps<{
  side: "A" | "B";
  hlsUrl: string;
  rtmpUrl: string;
}>();

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
      <div class="live">● {{ bi("scenes.match.waitingSignal") }}</div>
      <div v-if="rtmpUrl" class="rtmp">{{ rtmpUrl }}</div>
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
    rgba(0, 0, 0, 0.2) 0 1px,
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
@keyframes shift {
  0%, 100% { background-position: 0 0; }
  50% { background-position: 100% 100%; }
}
.live {
  font-size: clamp(12px, 1.4vw, 20px);
  font-weight: 800;
  color: var(--syn-magenta);
  letter-spacing: 1px;
  animation: blink 1.4s steps(2) infinite;
  z-index: 1;
}
@keyframes blink {
  50% { opacity: 0.4; }
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
</style>

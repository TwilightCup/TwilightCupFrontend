<script setup lang="ts">
/**
 * 合成器浪潮（synthwave）全屏背景：渐变天空 + 合成器太阳 + 透视霓虹网格地板。
 *
 * 纯 CSS/SVG，无外部资源（OBS 浏览器源离线缓存可靠）。固定在最底层（z-index:0），
 * 场景内容相对定位在其上。背景不透明，因此 .html 的 body 也是深紫底（见 scene-theme.css）。
 */
</script>

<template>
  <div class="synthwave-bg" aria-hidden="true">
    <!-- 天空渐变 -->
    <div class="sky" />

    <!-- 合成器太阳（横条切割） -->
    <div class="sun" />

    <!-- 透视霓虹网格地板 -->
    <div class="floor">
      <div class="grid" />
    </div>

    <!-- 远山辉光 -->
    <div class="horizon-glow" />
  </div>
</template>

<style scoped>
.synthwave-bg {
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  background: linear-gradient(
    180deg,
    var(--syn-purple-deep) 0%,
    var(--syn-purple) 38%,
    #4a1078 62%,
    #6e1688 70%,
    var(--syn-magenta) 100%
  );
}

/* 合成器太阳：品红→橙渐变圆盘，下半被横条切割 */
.sun {
  position: absolute;
  left: 50%;
  bottom: 42%;
  transform: translateX(-50%);
  width: 30vmin;
  height: 30vmin;
  border-radius: 50%;
  background: linear-gradient(0deg, #ffe066 0%, var(--syn-orange) 35%, var(--syn-magenta) 100%);
  box-shadow: 0 0 90px 18px rgba(255, 46, 136, 0.5);
  /* 横条切割：用背景在自身再叠一组横纹（盖住下半部分形成经典太阳） */
  -webkit-mask-image: repeating-linear-gradient(
    0deg,
    #000 0 78%,
    transparent 78% 80%,
    #000 80% 84%,
    transparent 84% 86%,
    #000 86% 90%,
    transparent 90% 92%,
    #000 92% 96%,
    transparent 96% 100%
  );
  mask-image: repeating-linear-gradient(
    0deg,
    #000 0 78%,
    transparent 78% 80%,
    #000 80% 84%,
    transparent 84% 86%,
    #000 86% 90%,
    transparent 90% 92%,
    #000 92% 96%,
    transparent 96% 100%
  );
}

/* 地平线辉光带 */
.horizon-glow {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 38%;
  height: 4px;
  background: var(--syn-cyan);
  box-shadow:
    0 0 20px 4px var(--syn-cyan),
    0 0 60px 14px rgba(34, 227, 255, 0.45);
}

/* 透视地板：容器造透视，子层用两组重复线性渐变绘网格 */
.floor {
  position: absolute;
  left: -50%;
  right: -50%;
  bottom: 0;
  height: 50%;
  perspective: 9vmin;
  perspective-origin: 50% 0;
}
.grid {
  position: absolute;
  inset: 0;
  transform: rotateX(74deg);
  transform-origin: 50% 0;
  background-image:
    repeating-linear-gradient(90deg, rgba(34, 227, 255, 0.55) 0 2px, transparent 2px 8vmin),
    repeating-linear-gradient(0deg, rgba(255, 46, 136, 0.45) 0 2px, transparent 2px 8vmin);
  animation: gridScroll 2.6s linear infinite;
}

@keyframes gridScroll {
  from {
    background-position:
      0 0,
      0 0;
  }
  to {
    background-position:
      0 0,
      0 8vmin;
  }
}
</style>

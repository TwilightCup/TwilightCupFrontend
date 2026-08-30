<script setup lang="ts">
/**
 * 合成器浪潮（synthwave）全屏背景：渐变天空 + 合成器太阳 + 透视霓虹网格地板。
 *
 * 纯 CSS/SVG，无外部资源（OBS 浏览器源离线缓存可靠）。固定在最底层（z-index:0），
 * 场景内容相对定位在其上。背景不透明，因此 .html 的 body 也是深紫底（见 scene-theme.css）。
 *
 * 背景样式由导播配置的 background 字段驱动（注册表见 useSceneBackgrounds）。
 * 组件自身读取 localStorage / URL 并监听 WS config_update 与跨标签 storage，
 * 因此 standalone 与 sharedBg 两种模式都能保持同一套切换逻辑。
 */
import { computed, onMounted, onUnmounted, watch } from "vue";
import { useDirectorStore } from "@/stores/director";
import { useSceneContext } from "@/scenes/composables/useSceneContext";
import { normalizeSceneBackground } from "@/scenes/composables/useSceneBackgrounds";
import { useDirectorConfig } from "@/scenes/composables/useDirectorConfig";

const { params } = useSceneContext();
const director = useDirectorStore();
const { config, load, save } = useDirectorConfig();

const background = computed(() => normalizeSceneBackground(config.background));

function configStorageKey(): string {
  return `twc-director-cfg:${params.matchId || "_global_"}`;
}

function onStorage(e: StorageEvent): void {
  if (e.key === configStorageKey()) {
    load(params.matchId, params);
  }
}

onMounted(() => {
  load(params.matchId, params);
  window.addEventListener("storage", onStorage);
});

onUnmounted(() => {
  window.removeEventListener("storage", onStorage);
});

// WS config_update 广播：舞台/独立场景即使不在导播控制台所在文档，也能实时切换背景。
watch(
  () => director.remoteConfig,
  (c) => {
    if (c) save(params.matchId, c);
  },
);
</script>

<template>
  <div class="synthwave-bg" :data-background="background" aria-hidden="true">
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
/* 当前默认背景 = 下方整套合成器浪潮样式；新增背景样式时在 base 之上按
   [data-background="key"] 追加覆盖层即可，组件渲染/选项配置已在注册表统一处理。 */
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
/*
 * 网格两层都用「单周期 tile + background-size 显式平铺」：
 * 渐变若不带尺寸（auto = 元素盒大小，如 540px），内部 8vmin 周期与 tile 边界
 * 不对齐，background-position 平移一个周期后 tile 接缝处相位跳变——表现为
 * 横线走一半突然重置。显式 8vmin tile 保证平移量恰为一个完整周期，逐帧无缝。
 */
.grid {
  position: absolute;
  inset: 0;
  transform: rotateX(74deg);
  transform-origin: 50% 0;
  background-image:
    linear-gradient(90deg, rgba(34, 227, 255, 0.55) 0 2px, transparent 2px),
    linear-gradient(to bottom, rgba(255, 46, 136, 0.45) 0 2px, transparent 2px);
  background-size:
    8vmin 8vmin,
    8vmin 8vmin;
  background-repeat: repeat, repeat;
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

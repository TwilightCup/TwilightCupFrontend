<script setup lang="ts">
/**
 * 合成器浪潮（synthwave）全屏背景：渐变天空 + 合成器太阳 + 透视霓虹网格地板。
 *
 * default / synthwave / synthwave1 为纯 CSS/SVG，无外部资源（OBS 浏览器源离线缓存可靠）；
 * synthwave2「水面浪潮2」使用内联 GLSL 的全屏 WebGL 重绘（见 WaterShaderBg.vue），
 * WebGL 不可用时自动回退到 synthwave 的 CSS/SVG 水面。固定在最底层（z-index:0），
 * 场景内容相对定位在其上。背景不透明，因此 .html 的 body 也是深紫底（见 scene-theme.css）。
 *
 * 背景样式由导播配置的 background 字段驱动（注册表见 useSceneBackgrounds）。
 * 组件自身读取 localStorage / URL 并监听 WS config_update 与跨标签 storage，
 * 因此 standalone 与 sharedBg 两种模式都能保持同一套切换逻辑。
 */
import { computed, onMounted, onUnmounted, ref, useId, watch } from "vue";
import { useDirectorStore } from "@/stores/director";
import { useSceneContext } from "@/scenes/composables/useSceneContext";
import { normalizeSceneBackground } from "@/scenes/composables/useSceneBackgrounds";
import { useDirectorConfig } from "@/scenes/composables/useDirectorConfig";
import WaterShaderBg from "@/scenes/components/WaterShaderBg.vue";

const { params } = useSceneContext();
const director = useDirectorStore();
const { config, load, refresh, save } = useDirectorConfig();

const background = computed(() => normalizeSceneBackground(config.background));

/**
 * 所有「水面浪潮」系背景共享同一套切换/回退逻辑：
 *  - synthwave / synthwave1 继续使用现有 CSS/SVG 骨架；
 *  - synthwave2 使用全屏 WebGL 重绘，失败时回退到原版 synthwave 的 CSS/SVG 水面。
 */
const isWater = computed(
  () =>
    background.value === "synthwave" ||
    background.value === "synthwave1" ||
    background.value === "synthwave2",
);
const isWaterV1 = computed(() => background.value === "synthwave1");
const isWaterV2 = computed(() => background.value === "synthwave2");
/** WebGL 不可用 / 上下文丢失时置位，用于回退 CSS/SVG 水面。 */
const shaderUnavailable = ref(false);
/** 当前是否实际由 CSS/SVG 渲染水面（synthwave2 WebGL 正常工作时为 false）。 */
const isWaterCss = computed(
  () => isWater.value && !(isWaterV2.value && !shaderUnavailable.value),
);
/** 回退时把 data-background 映射回原版 synthwave，让现有 CSS 规则直接生效。 */
const renderBackground = computed(() =>
  isWaterV2.value && shaderUnavailable.value ? "synthwave" : background.value,
);

function configStorageKey(): string {
  return `twc-director-cfg:${params.matchId || "_global_"}`;
}

function onStorage(e: StorageEvent): void {
  if (e.key === configStorageKey()) {
    // 只读刷新，不写回：避免多个预览/场景之间相互触发 localStorage 写入风暴，
    // 也避免舞台 URL 中过期的 background 参数覆盖已经广播/保存的新背景。
    refresh(params.matchId);
  }
}

onMounted(() => {
  load(params.matchId, params);
  window.addEventListener("storage", onStorage);
});

onUnmounted(() => {
  window.removeEventListener("storage", onStorage);
  stopRipple();
});

// WS config_update 广播：舞台/独立场景即使不在导播控制台所在文档，也能实时切换背景。
watch(
  () => director.remoteConfig,
  (c) => {
    if (c) save(params.matchId, c);
  },
);

// ---- synthwave 水面版专用资源 ----
// SVG id 用 useId 保证同一文档内多个 SynthwaveBg（舞台交叉切换/独立预览）不冲突。
const bgSuffix = useId();
const sunGradId = `sun-grad-${bgSuffix}`;
const sunMaskId = `sun-mask-${bgSuffix}`;
const sunMaskV1Id = `sun-mask-v1-${bgSuffix}`;
const sunHaloId = `sun-halo-${bgSuffix}`;
const sunGradReflId = `sun-grad-refl-${bgSuffix}`;
const sunMaskReflId = `sun-mask-refl-${bgSuffix}`;
const waterRippleId = `water-ripple-${bgSuffix}`;
const waterRippleGridId = `water-ripple-grid-${bgSuffix}`;

/** 顶部天空随机星星：仅合成器浪潮水面版需要，位置/闪烁参数在挂载时随机固定。 */
interface Star {
  id: number;
  left: number;
  top: number;
  size: number;
  delay: string;
  duration: string;
  maxOpacity: number;
}

/** 生成一组随机星星；idOffset 用于让 synthwave1 的额外星群拥有独立 key。 */
function createStars(count: number, idOffset = 0): Star[] {
  return Array.from({ length: count }, (_, i): Star => ({
    id: idOffset + i,
    left: Math.random() * 100,
    top: Math.random() * 36,
    size: 1 + Math.random() * 1.6,
    delay: `${(Math.random() * 8).toFixed(2)}s`,
    duration: `${(3 + Math.random() * 6).toFixed(2)}s`,
    maxOpacity: 0.18 + Math.random() * 0.5,
  }));
}

const stars = createStars(96);
/** synthwave1 额外增加的星群：让星空比原版更密、更有层次。 */
const v1Stars = createStars(72, 1000);

function starStyle(s: Star): Record<string, string> {
  return {
    left: `${s.left.toFixed(2)}%`,
    top: `${s.top.toFixed(2)}%`,
    width: `${s.size.toFixed(2)}px`,
    height: `${s.size.toFixed(2)}px`,
    "--star-delay": s.delay,
    "--star-duration": s.duration,
    "--star-max": String(s.maxOpacity),
  };
}

// ---- 水波置换动画 ----
// SVG feTurbulence 的 baseFrequency 无法用 CSS 动画驱动，这里用 rAF 低速
// 更新（约 20fps），让反射与水下网格的折射场本身持续缓慢流动，静态倒影
// 和静态竖线也能看到波纹在动。
const reflTurbulence = ref<Element | null>(null);
const gridTurbulence = ref<Element | null>(null);
let rippleRaf = 0;
let rippleLast = 0;
let rippleElapsed = 0;

function setTurbulenceBaseFrequency(el: Element | null, x: number, y: number): void {
  el?.setAttribute("baseFrequency", `${x.toFixed(4)} ${y.toFixed(4)}`);
}

/**
 * 三角波 0→1→0（周期 period 秒，phase 为 0~1 的相位偏移）。
 * 对时间求导为常量：baseFrequency 在两端点间来回匀速变化，避免正弦波
 * 导数呈余弦造成的“快→慢→快→慢”呼吸感。
 */
function triangle01(t: number, period: number, phase = 0): number {
  const p = (t / period + phase) % 1;
  return p < 0.5 ? p * 2 : 2 - p * 2;
}

function rippleFrame(now: number): void {
  rippleRaf = requestAnimationFrame(rippleFrame);
  if (!rippleLast) {
    rippleLast = now;
    return;
  }
  if (now - rippleLast < 50) return; // 20fps，水波低频流动足够平滑
  rippleElapsed += (now - rippleLast) / 1000;
  rippleLast = now;
  const t = rippleElapsed;

  const reflU = triangle01(t, 9);
  const gridU = triangle01(t, 9, 0.25);
  setTurbulenceBaseFrequency(
    reflTurbulence.value,
    0.007 + reflU * 0.002,
    0.017 + reflU * 0.004,
  );
  setTurbulenceBaseFrequency(
    gridTurbulence.value,
    0.012 + gridU * 0.003,
    0.027 + gridU * 0.005,
  );
}

function startRipple(): void {
  if (rippleRaf) return;
  rippleLast = 0;
  rippleElapsed = 0;
  rippleRaf = requestAnimationFrame(rippleFrame);
}

function stopRipple(): void {
  if (!rippleRaf) return;
  cancelAnimationFrame(rippleRaf);
  rippleRaf = 0;
}

// 背景切换时重试 WebGL；只有实际走 CSS/SVG 水面分支时才运行 SVG 置换 rAF。
watch(
  background,
  () => {
    if (isWaterV2.value) shaderUnavailable.value = false;
    if (isWaterCss.value) startRipple();
    else stopRipple();
  },
  { immediate: true, flush: "post" },
);
watch(shaderUnavailable, () => {
  if (isWaterCss.value) startRipple();
  else stopRipple();
});
</script>

<template>
  <div class="synthwave-bg" :data-background="renderBackground" aria-hidden="true">
    <!-- synthwave2：全屏 WebGL 重绘；失败时 shaderUnavailable=true，下面的 CSS/SVG 分支接管 -->
    <WaterShaderBg
      v-if="isWaterV2 && !shaderUnavailable"
      @failed="shaderUnavailable = true"
    />
    <template v-else>
    <!-- 天空渐变（default 为空层；synthwave 水面版用 CSS 画出日落渐变） -->
    <div class="sky" />

    <!-- synthwave1：星云 / 极光层，给天空增加复古未来氛围 -->
    <template v-if="isWaterV1">
      <div class="sky-nebula" />
      <div class="sky-aurora" />
    </template>

    <!-- 随机缓慢闪烁星星（仅水面版） -->
    <div v-if="isWater" class="stars" :class="{ 'stars-v1': isWaterV1 }">
      <i v-for="s in stars" :key="s.id" class="star" :style="starStyle(s)" />
      <template v-if="isWaterV1">
        <i v-for="s in v1Stars" :key="`v1-star-${s.id}`" class="star" :style="starStyle(s)" />
      </template>
    </div>

    <!-- synthwave1：偶发流星，为静态星空增加一点生命感 -->
    <div v-if="isWaterV1" class="shooting-stars" aria-hidden="true">
      <i class="shooting-star" />
      <i class="shooting-star" />
    </div>

    <!-- 远山剪影（仅水面版） -->
    <svg
      v-if="isWater"
      class="mountains"
      :class="{ 'mountains-v1': isWaterV1 }"
      viewBox="0 0 1920 260"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <!-- 后层山：偏亮的紫红，带一点辉光 -->
      <path
        fill="#5a1773"
        d="M0 190 L70 132 L118 170 L190 90 L248 150 L330 120 L400 178 L470 102 L560 162 L650 96 L720 158 L800 128 L880 178 L960 90 L1040 162 L1120 122 L1200 182 L1290 104 L1380 160 L1460 120 L1540 180 L1640 100 L1730 160 L1810 124 L1920 184 L1920 260 L0 260 Z"
      />
      <!-- 中后层山：更暗的紫 -->
      <path
        fill="#380b5c"
        d="M0 210 L100 158 L190 206 L280 142 L360 202 L470 150 L560 210 L660 154 L760 208 L860 148 L960 204 L1080 152 L1180 214 L1280 158 L1380 210 L1480 146 L1580 214 L1690 160 L1780 208 L1920 176 L1920 260 L0 260 Z"
      />
      <!-- 前层山：近黑紫，压住地平线 -->
      <path
        fill="#23083d"
        d="M0 238 L120 190 L240 236 L360 186 L480 238 L600 194 L720 240 L840 188 L960 236 L1080 192 L1200 240 L1320 190 L1440 238 L1560 194 L1680 240 L1800 194 L1920 228 L1920 260 L0 260 Z"
      />
    </svg>

    <!-- synthwave1：山脉脚下的暖色雾气，让远山与地平线衔接更自然 -->
    <div v-if="isWaterV1" class="mountain-mist" />

    <!-- 合成器太阳：default 使用旧 CSS 圆盘；synthwave 水面版使用 SVG 精确做出下半镂空横线 -->
    <svg
      v-if="isWater"
      class="sun-svg"
      :class="{ 'sun-v1': isWaterV1 }"
      viewBox="0 0 200 200"
      aria-hidden="true"
    >
      <defs>
        <linearGradient :id="sunGradId" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#fff3af" />
          <stop offset="0.42" stop-color="#ffd166" />
          <stop offset="0.72" stop-color="#ff8a3d" />
          <stop offset="1" stop-color="#ff2e88" />
        </linearGradient>
        <radialGradient v-if="isWaterV1" :id="sunHaloId" cx="50%" cy="50%" r="50%">
          <stop offset="0" stop-color="#fff8d6" stop-opacity="0.5" />
          <stop offset="0.35" stop-color="#ffd166" stop-opacity="0.28" />
          <stop offset="0.68" stop-color="#ff8a3d" stop-opacity="0.14" />
          <stop offset="1" stop-color="#ff2e88" stop-opacity="0" />
        </radialGradient>
        <mask :id="sunMaskId" maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="200">
          <circle cx="100" cy="100" r="98" fill="#fff" />
          <g fill="#000">
            <rect x="0" y="112" width="200" height="3" />
            <rect x="0" y="122" width="200" height="3" />
            <rect x="0" y="132" width="200" height="3" />
            <rect x="0" y="142" width="200" height="4" />
            <rect x="0" y="153" width="200" height="4" />
            <rect x="0" y="164" width="200" height="4" />
            <rect x="0" y="176" width="200" height="5" />
            <rect x="0" y="188" width="200" height="6" />
          </g>
        </mask>
        <mask
          v-if="isWaterV1"
          :id="sunMaskV1Id"
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="200"
          height="200"
        >
          <circle cx="100" cy="100" r="98" fill="#fff" />
          <g fill="#000">
            <rect x="0" y="106" width="200" height="4" />
            <rect x="0" y="116" width="200" height="5" />
            <rect x="0" y="127" width="200" height="5" />
            <rect x="0" y="138" width="200" height="6" />
            <rect x="0" y="150" width="200" height="6" />
            <rect x="0" y="162" width="200" height="7" />
            <rect x="0" y="175" width="200" height="8" />
            <rect x="0" y="189" width="200" height="9" />
          </g>
        </mask>
      </defs>
      <circle
        v-if="isWaterV1"
        class="sun-halo"
        cx="100"
        cy="100"
        r="118"
        :fill="`url(#${sunHaloId})`"
      />
      <circle
        cx="100"
        cy="100"
        r="98"
        :fill="`url(#${sunGradId})`"
        :mask="isWaterV1 ? `url(#${sunMaskV1Id})` : `url(#${sunMaskId})`"
      />
      <circle
        v-if="isWaterV1"
        class="sun-ring"
        cx="100"
        cy="100"
        r="99"
        fill="none"
        stroke="rgba(255, 244, 214, 0.78)"
        stroke-width="1.4"
      />
    </svg>
    <div v-else class="sun" />

    <!-- 水面：网格之上叠加真实水面反射/波纹/折射；网格被水波置换后像沉在水下 -->
    <div v-if="isWater" class="water">
      <!-- synthwave1：地平线霓虹线，把天空和水面切成更清晰的两层 -->
      <div v-if="isWaterV1" class="water-horizon-glow" />

      <!-- 水波置换滤镜：给水面反射与水下网格做像素级波纹折射（无颜色覆盖） -->
      <svg class="water-filter-defs" aria-hidden="true">
        <defs>
          <filter
            :id="waterRippleId"
            x="-12%"
            y="-12%"
            width="124%"
            height="124%"
            color-interpolation-filters="sRGB"
          >
            <feTurbulence
              ref="reflTurbulence"
              type="fractalNoise"
              baseFrequency="0.007 0.017"
              numOctaves="4"
              seed="7"
              result="noise"
            />
            <!-- 先对噪声做高斯平滑，再做置换：波纹边缘更柔，不会把反射画面整层弄糊，
                 也能避免顶部边界被最终模糊拉出透明缝隙。 -->
            <feGaussianBlur in="noise" stdDeviation="1.8" result="softNoise" />
            <feDisplacementMap
              in="SourceGraphic"
              in2="softNoise"
              scale="9"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
          <filter
            :id="waterRippleGridId"
            x="-12%"
            y="-12%"
            width="124%"
            height="124%"
            color-interpolation-filters="sRGB"
          >
            <feTurbulence
              ref="gridTurbulence"
              type="fractalNoise"
              baseFrequency="0.012 0.027"
              numOctaves="3"
              seed="11"
              result="noise"
            />
            <feGaussianBlur in="noise" stdDeviation="1.2" result="softNoise" />
            <feDisplacementMap
              in="SourceGraphic"
              in2="softNoise"
              scale="4.5"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
      </svg>

      <!-- 网格层：向镜头滚动，并叠加 SVG 水波位移模拟透过水面看到的折射 -->
      <div
        class="floor"
        :style="{ filter: `url(#${waterRippleGridId})`, WebkitFilter: `url(#${waterRippleGridId})` }"
      >
        <div class="grid-vertical" />
        <div class="grid-horizontal" />
        <div v-if="isWaterV1" class="grid-axis" />
      </div>

      <!-- 水面层：位于网格上方，只做反射/波纹/波光，不添加任何颜色覆盖 -->
      <div
        class="water-surface"
        :style="{ filter: `url(#${waterRippleId})`, WebkitFilter: `url(#${waterRippleId})` }"
      >
        <!-- 上方场景（天空/星星/远山/太阳）关于地平线的翻转反射 -->
        <div class="water-reflection">
          <div class="refl-sky" />
          <div class="stars refl-stars">
            <i v-for="s in stars" :key="`refl-star-${s.id}`" class="star" :style="starStyle(s)" />
          </div>
          <svg
            class="mountains refl-mountains"
            viewBox="0 0 1920 260"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path
              fill="#5a1773"
              d="M0 190 L70 132 L118 170 L190 90 L248 150 L330 120 L400 178 L470 102 L560 162 L650 96 L720 158 L800 128 L880 178 L960 90 L1040 162 L1120 122 L1200 182 L1290 104 L1380 160 L1460 120 L1540 180 L1640 100 L1730 160 L1810 124 L1920 184 L1920 260 L0 260 Z"
            />
            <path
              fill="#380b5c"
              d="M0 210 L100 158 L190 206 L280 142 L360 202 L470 150 L560 210 L660 154 L760 208 L860 148 L960 204 L1080 152 L1180 214 L1280 158 L1380 210 L1480 146 L1580 214 L1690 160 L1780 208 L1920 176 L1920 260 L0 260 Z"
            />
            <path
              fill="#23083d"
              d="M0 238 L120 190 L240 236 L360 186 L480 238 L600 194 L720 240 L840 188 L960 236 L1080 192 L1200 240 L1320 190 L1440 238 L1560 194 L1680 240 L1800 194 L1920 228 L1920 260 L0 260 Z"
            />
          </svg>
          <svg class="sun-svg refl-sun" viewBox="0 0 200 200" aria-hidden="true">
            <defs>
              <linearGradient :id="sunGradReflId" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stop-color="#fff3af" />
                <stop offset="0.42" stop-color="#ffd166" />
                <stop offset="0.72" stop-color="#ff8a3d" />
                <stop offset="1" stop-color="#ff2e88" />
              </linearGradient>
              <mask :id="sunMaskReflId" maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="200">
                <circle cx="100" cy="100" r="98" fill="#fff" />
                <g fill="#000">
                  <rect x="0" y="112" width="200" height="3" />
                  <rect x="0" y="122" width="200" height="3" />
                  <rect x="0" y="132" width="200" height="3" />
                  <rect x="0" y="142" width="200" height="4" />
                  <rect x="0" y="153" width="200" height="4" />
                  <rect x="0" y="164" width="200" height="4" />
                  <rect x="0" y="176" width="200" height="5" />
                  <rect x="0" y="188" width="200" height="6" />
                </g>
              </mask>
            </defs>
            <circle
              cx="100"
              cy="100"
              r="98"
              :fill="`url(#${sunGradReflId})`"
              :mask="`url(#${sunMaskReflId})`"
            />
          </svg>
        </div>

        <!-- 波光：透明底上的高光细纹，随水波缓慢漂移 -->
        <div v-if="isWaterV1" class="water-caustics" />
        <div v-if="isWaterV1" class="water-light-column" />
        <div class="water-glints" />
      </div>

      <div class="water-shade" />
    </div>
    <!-- default：原有透视网格地板 -->
    <div v-else class="floor">
      <div class="grid" />
    </div>

    <!-- 合成器浪潮水面版不画中线：山脉底部直接贴网格起始点 -->
    <div v-if="!isWater" class="horizon-glow" />

    <!-- synthwave1：地平线高光带，强化「夕阳沉入水面」的切割感 -->
    <div v-if="isWaterV1" class="horizon-glow-v1" />

    <!-- 顶部/底部压暗，贴近参考图的暗角 -->
    <div v-if="isWater" class="vignette" />
    </template>
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

/* ============================================================
   synthwave 水面版（?background=synthwave）
   ============================================================ */

/* 整体：天顶近黑，地平线亮品红，水面回落到深紫黑，上下氛围压暗 */
.synthwave-bg:is([data-background="synthwave"], [data-background="synthwave1"]) {
  background: linear-gradient(
    180deg,
    #08010f 0%,
    #12022a 30%,
    #2a0a4c 48%,
    #9a1e75 58%,
    #ff2e88 61%,
    #40083f 65%,
    #1c0534 78%,
    #0a0118 100%
  );
}

/* 天空：地平线附近的暖粉色辉光 */
.synthwave-bg:is([data-background="synthwave"], [data-background="synthwave1"]) .sky {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 55%;
  background: linear-gradient(
    180deg,
    #08010f 0%,
    #100224 24%,
    #2a0a4c 44%,
    #6b1565 56%,
    #c32280 66%,
    #ff4d9b 76%,
    #ff2e88 100%
  );
}

/* 星星：天花板区域随机小点，用透明度呼吸模拟缓慢闪烁 */
.synthwave-bg:is([data-background="synthwave"], [data-background="synthwave1"]) .stars {
  position: absolute;
  inset: 0 0 64% 0;
  pointer-events: none;
}
.synthwave-bg:is([data-background="synthwave"], [data-background="synthwave1"]) .star {
  position: absolute;
  border-radius: 50%;
  background: #eef0ff;
  box-shadow: 0 0 3px rgba(238, 240, 255, 0.8);
  opacity: 0.12;
  animation: starTwinkle var(--star-duration, 4s) ease-in-out infinite;
  animation-delay: var(--star-delay, 0s);
}
@keyframes starTwinkle {
  0%, 100% { opacity: 0.04; transform: scale(0.7); }
  50% { opacity: var(--star-max, 0.5); transform: scale(1.15); }
}

/* 远山：三层剪影，底部刚好坐在水面地平线上 */
.synthwave-bg:is([data-background="synthwave"], [data-background="synthwave1"]) .mountains {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 49.8%;
  height: 13%;
  width: 100%;
  opacity: 0.92;
}
.synthwave-bg:is([data-background="synthwave"], [data-background="synthwave1"]) .mountains path {
  filter: drop-shadow(0 -4px 10px rgba(255, 46, 136, 0.16));
}

/* 中央太阳：比默认更大、更暖，底部被山水面裁切 */
.synthwave-bg:is([data-background="synthwave"], [data-background="synthwave1"]) .sun-svg {
  position: absolute;
  left: 50%;
  bottom: 45%;
  transform: translateX(-50%);
  width: 36vmin;
  height: 36vmin;
  overflow: visible;
  filter:
    drop-shadow(0 0 18px rgba(255, 46, 136, 0.55))
    drop-shadow(0 0 72px rgba(255, 138, 61, 0.3));
}

/* 水面：上半透出地平线辉光，整体深紫黑 */
.synthwave-bg:is([data-background="synthwave"], [data-background="synthwave1"]) .water {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 49.8%;
  overflow: hidden;
  background: linear-gradient(
    180deg,
    #40103a 0%,
    #29082f 9%,
    #15062a 32%,
    #10032c 62%,
    #0a0120 100%
  );
}
/* 水面版网格：拆成两层。
   层1 grid-vertical：透视纵线从地平线一路延伸到画面底部，负责“网格延伸得更远”；
   层2 grid-horizontal：横线持续向镜头滚动；整层填满水面，让网格从地平线
   一路延伸到画面底部。 */
.synthwave-bg:is([data-background="synthwave"], [data-background="synthwave1"]) .floor {
  height: 100%;
  perspective: 26vmin;
  perspective-origin: 50% 0;
  z-index: 1;
}
.synthwave-bg:is([data-background="synthwave"], [data-background="synthwave1"]) .grid-vertical,
.synthwave-bg:is([data-background="synthwave"], [data-background="synthwave1"]) .grid-horizontal {
  position: absolute;
  inset: 0;
  transform-origin: 50% 0;
}
.synthwave-bg:is([data-background="synthwave"], [data-background="synthwave1"]) .grid-vertical {
  transform: rotateX(67deg);
  background-image:
    linear-gradient(90deg, rgba(255, 255, 255, 0.85) 0 0.75px, rgba(255, 94, 181, 1) 0.75px 1.75px, transparent 1.75px);
  background-size: 8vmin 8vmin;
  background-repeat: repeat;
  filter:
    brightness(1.3)
    saturate(1.15)
    drop-shadow(0 0 3px rgba(255, 255, 255, 0.5))
    drop-shadow(0 0 4px rgba(255, 46, 136, 0.6))
    drop-shadow(0 0 12px rgba(255, 46, 136, 0.25));
  -webkit-mask-image: linear-gradient(to bottom, transparent 0%, rgba(0, 0, 0, 0.6) 4%, #000 10%, #000 100%);
  mask-image: linear-gradient(to bottom, transparent 0%, rgba(0, 0, 0, 0.6) 4%, #000 10%, #000 100%);
  animation: gridWater 4.2s ease-in-out infinite;
}
.synthwave-bg:is([data-background="synthwave"], [data-background="synthwave1"]) .grid-horizontal {
  transform: rotateX(67deg);
  background-image:
    linear-gradient(to bottom, rgba(255, 255, 255, 0.85) 0 0.75px, rgba(255, 94, 181, 1) 0.75px 1.75px, transparent 1.75px);
  background-size: 8vmin 8vmin;
  background-repeat: repeat;
  filter:
    brightness(1.3)
    saturate(1.15)
    drop-shadow(0 0 3px rgba(255, 255, 255, 0.5))
    drop-shadow(0 0 5px rgba(255, 46, 136, 0.6))
    drop-shadow(0 0 14px rgba(255, 46, 136, 0.25));
  -webkit-mask-image: linear-gradient(to bottom, transparent 0%, rgba(0, 0, 0, 0.6) 4%, #000 10%, #000 100%);
  mask-image: linear-gradient(to bottom, transparent 0%, rgba(0, 0, 0, 0.6) 4%, #000 10%, #000 100%);
  animation:
    synthwaveGridScroll 3s linear infinite,
    gridWater 4.2s ease-in-out infinite;
}

/* 水面版专用滚动：background-size 为 8vmin，必须平移正好一个完整 tile，
   才能保证逐帧连续、循环时无跳变 */
@keyframes synthwaveGridScroll {
  from {
    background-position: 0 0;
  }
  to {
    background-position: 0 8vmin;
  }
}

/* 水面折射：网格除持续向前滚动外，还随水面轻微摆动，体现被水波影响 */
@keyframes gridWater {
  0%, 100% {
    transform: rotateX(67deg) translateY(0) skewX(0deg);
  }
  50% {
    transform: rotateX(67deg) translateY(-6px) skewX(0.8deg);
  }
}

/* 水面滤镜定义：仅提供 feTurbulence/feDisplacementMap 置换源，本身不渲染像素 */
.synthwave-bg:is([data-background="synthwave"], [data-background="synthwave1"]) .water-filter-defs {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
  pointer-events: none;
}

/* 水面层：覆盖在网格上方，透明底 + 深度遮罩淡出，只做反射/波纹/波光 */
.synthwave-bg:is([data-background="synthwave"], [data-background="synthwave1"]) .water-surface {
  position: absolute;
  inset: 0;
  z-index: 2;
  overflow: hidden;
  pointer-events: none;
  background: transparent;
  -webkit-mask-image: linear-gradient(
    to bottom,
    rgba(0, 0, 0, 1) 0%,
    rgba(0, 0, 0, 1) 3%,
    rgba(0, 0, 0, 0.5) 30%,
    rgba(0, 0, 0, 0.18) 62%,
    transparent 96%
  );
  mask-image: linear-gradient(
    to bottom,
    rgba(0, 0, 0, 1) 0%,
    rgba(0, 0, 0, 1) 3%,
    rgba(0, 0, 0, 0.5) 30%,
    rgba(0, 0, 0, 0.18) 62%,
    transparent 96%
  );
}

/*
 * 反射层：内部坐标系与整屏一致（top:-100.8032% + height:200.8032% 刚好铺满
 * 整屏），再以地平线（transform-origin 50% 50.2%）为轴垂直翻转。这样上方天空、
 * 星星、远山、太阳会以地平线为对称轴映射到水面区域，且越靠近镜头越淡出。
 */
.synthwave-bg:is([data-background="synthwave"], [data-background="synthwave1"]) .water-reflection {
  position: absolute;
  left: 0;
  right: 0;
  /* top 额外上探 1px：让倒影地平线略微越过水面裁切线，抵消 CSS 百分比取整
     造成的亚像素缝隙；overflow:hidden 会裁掉多出的部分。 */
  top: calc(-100.8032% - 1px);
  height: 200.8032%;
  /* 只做地平线翻转，不做位移/偏斜动画：任何 translateY 都会让倒影与
     实物在水平线处拉开缝隙。水波纹动感由 feTurbulence 置换场本身流动提供。 */
  transform: scaleY(-1);
  transform-origin: 50% 50.2%;
  opacity: 0.52;
}

/* 反射用天空：与上方 .sky 同一渐变，按整屏坐标系摆放 */
.synthwave-bg:is([data-background="synthwave"], [data-background="synthwave1"]) .refl-sky {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 55%;
  background: linear-gradient(
    180deg,
    #08010f 0%,
    #100224 24%,
    #2a0a4c 44%,
    #6b1565 56%,
    #c32280 66%,
    #ff4d9b 76%,
    #ff2e88 100%
  );
}

/* 反射层里的星星容器：沿用 .stars/.star 样式，按整屏坐标摆放后随反射翻转 */
.synthwave-bg:is([data-background="synthwave"], [data-background="synthwave1"]) .refl-stars {
  opacity: 0.9;
}

/* 波光：透明底上的柔和高光带，经 SVG 置换后随水波扭动；无颜色覆盖。
   渐变起点/终点都是 transparent，避免硬边在置换后出现像素锯齿。 */
.synthwave-bg:is([data-background="synthwave"], [data-background="synthwave1"]) .water-glints {
  position: absolute;
  inset: -6% 0;
  pointer-events: none;
  opacity: 0.22;
  mix-blend-mode: screen;
  background-image:
    repeating-linear-gradient(
      112deg,
      transparent 0 18px,
      rgba(255, 255, 255, 0.07) 30px,
      rgba(255, 255, 255, 0) 44px,
      transparent 62px
    ),
    repeating-linear-gradient(
      68deg,
      transparent 0 28px,
      rgba(190, 235, 255, 0.05) 44px,
      rgba(190, 235, 255, 0) 58px,
      transparent 78px
    );
  background-size:
    140% 140%,
    160% 160%;
  animation: waterGlintsDrift 9s linear infinite;
}

@keyframes waterGlintsDrift {
  from {
    background-position:
      0 0,
      0 0;
  }
  to {
    background-position:
      46px 20px,
      -54px 30px;
  }
}

/* 水面整体压暗，保证底部深、不抢前景内容 */
.synthwave-bg:is([data-background="synthwave"], [data-background="synthwave1"]) .water-shade {
  position: absolute;
  inset: 0;
  z-index: 3;
  background:
    linear-gradient(to bottom, rgba(10, 1, 24, 0.03) 0%, rgba(10, 1, 24, 0.2) 32%, rgba(10, 1, 24, 0.55) 100%);
}

/* 顶部/底部四角压暗，模拟参考图边缘更深 */
.synthwave-bg:is([data-background="synthwave"], [data-background="synthwave1"]) .vignette {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(ellipse 120% 80% at 50% 50%, transparent 46%, rgba(5, 0, 15, 0.28) 78%, rgba(3, 0, 10, 0.62) 100%),
    linear-gradient(to bottom, rgba(8, 1, 15, 0.5) 0%, transparent 18%, transparent 78%, rgba(5, 0, 12, 0.48) 100%);
}

/* ============================================================
   synthwave1（水面浪潮 1）：水面浪潮的增强版本
   在 synthwave 的 DOM 骨架上叠加更浓的夕阳、星云、流星、山脉辉光、
   霓虹网格与水面光柱；原 synthwave 预设保持不变。
   ============================================================ */

/* 整体天空：天顶更深，地平线更亮，水面一侧保留深紫黑 */
.synthwave-bg[data-background="synthwave1"] {
  background:
    radial-gradient(ellipse 78% 44% at 50% 60%, rgba(255, 46, 136, 0.2), transparent 72%),
    linear-gradient(
      180deg,
      #02000a 0%,
      #08001f 18%,
      #25094c 38%,
      #7d177f 52%,
      #ff2e88 60%,
      #ff8a3d 62%,
      #3a0b45 66%,
      #13032e 82%,
      #03000b 100%
    );
}

/* 天空渐变：加入暖金色夕阳核与更宽的品红辉光 */
.synthwave-bg[data-background="synthwave1"] .sky {
  height: 56%;
  background:
    radial-gradient(ellipse 46% 30% at 50% 78%, rgba(255, 209, 102, 0.28), transparent 70%),
    radial-gradient(ellipse 74% 48% at 50% 80%, rgba(255, 46, 136, 0.4), transparent 74%),
    linear-gradient(
      180deg,
      #02000a 0%,
      #0a0125 22%,
      #2a0a4c 40%,
      #7d177f 52%,
      #d92286 60%,
      #ff5b9f 68%,
      #ff2e88 100%
    );
}

/* 星云：两团低饱和的青色/品红雾，给深色天空一点层次 */
.synthwave-bg[data-background="synthwave1"] .sky-nebula {
  position: absolute;
  left: -6%;
  right: -6%;
  top: -4%;
  height: 64%;
  pointer-events: none;
  opacity: 0.52;
  mix-blend-mode: screen;
  filter: blur(18px);
  background:
    radial-gradient(ellipse 28% 24% at 16% 24%, rgba(34, 227, 255, 0.14), transparent 70%),
    radial-gradient(ellipse 40% 30% at 84% 18%, rgba(255, 46, 136, 0.18), transparent 72%),
    radial-gradient(ellipse 58% 32% at 52% 62%, rgba(255, 138, 61, 0.12), transparent 74%);
  animation: nebulaDrift 18s ease-in-out infinite alternate;
}

/* 极光带：一条斜向的柔光带，增加复古未来感 */
.synthwave-bg[data-background="synthwave1"] .sky-aurora {
  position: absolute;
  left: -12%;
  right: -12%;
  top: 26%;
  height: 15%;
  pointer-events: none;
  opacity: 0.32;
  mix-blend-mode: screen;
  filter: blur(20px);
  transform: skewX(-9deg);
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(34, 227, 255, 0.14) 22%,
    rgba(255, 46, 136, 0.24) 48%,
    rgba(255, 138, 61, 0.14) 72%,
    transparent 100%
  );
  animation: auroraShift 14s ease-in-out infinite alternate;
}

/* 星空：更亮的呼吸、青/粉色星点，部分亮星带十字星芒 */
.synthwave-bg[data-background="synthwave1"] .stars-v1 {
  inset: 0 0 60% 0;
}
.synthwave-bg[data-background="synthwave1"] .stars-v1 .star {
  background: #ffffff;
  box-shadow:
    0 0 3px rgba(255, 255, 255, 0.95),
    0 0 8px rgba(140, 230, 255, 0.8),
    0 0 16px rgba(255, 46, 136, 0.42);
  animation-name: starTwinkleV1;
}
.synthwave-bg[data-background="synthwave1"] .stars-v1 .star:nth-child(3n) {
  background: #c9f7ff;
}
.synthwave-bg[data-background="synthwave1"] .stars-v1 .star:nth-child(5n) {
  background: #ffd1e8;
}
.synthwave-bg[data-background="synthwave1"] .stars-v1 .star:nth-child(7n) {
  width: 3px !important;
  height: 3px !important;
  box-shadow:
    0 0 4px rgba(255, 255, 255, 0.95),
    0 0 11px rgba(255, 255, 255, 0.85),
    0 0 22px rgba(34, 227, 255, 0.72),
    0 0 34px rgba(255, 46, 136, 0.46);
}
.synthwave-bg[data-background="synthwave1"] .stars-v1 .star:nth-child(11n) {
  width: 3.5px !important;
  height: 3.5px !important;
}
.synthwave-bg[data-background="synthwave1"] .stars-v1 .star:nth-child(11n)::before,
.synthwave-bg[data-background="synthwave1"] .stars-v1 .star:nth-child(11n)::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  width: 13px;
  height: 1.5px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 0 6px rgba(255, 255, 255, 0.95), 0 0 12px rgba(34, 227, 255, 0.76);
  transform: translate(-50%, -50%);
}
.synthwave-bg[data-background="synthwave1"] .stars-v1 .star:nth-child(11n)::after {
  width: 1.5px;
  height: 13px;
}

/* 流星：低频划过天顶，不影响前景阅读 */
.synthwave-bg[data-background="synthwave1"] .shooting-stars {
  position: absolute;
  inset: 0 0 58% 0;
  overflow: hidden;
  pointer-events: none;
}
.synthwave-bg[data-background="synthwave1"] .shooting-star {
  position: absolute;
  top: 13%;
  left: 70%;
  width: 118px;
  height: 2px;
  border-radius: 999px;
  opacity: 0;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.95), rgba(180, 240, 255, 0.9));
  box-shadow:
    0 0 8px rgba(160, 230, 255, 0.9),
    0 0 18px rgba(255, 46, 136, 0.52);
  transform: translate3d(0, 0, 0) rotate(-28deg) scaleX(0.2);
  animation: shootingStar 9s linear infinite;
}
.synthwave-bg[data-background="synthwave1"] .shooting-star:nth-child(2) {
  top: 31%;
  left: 18%;
  animation-delay: 4.8s;
  animation-duration: 11s;
}

/* 远山：抬高一点，增加饱和度，并给山脊线加一圈品红/暖白辉光 */
.synthwave-bg[data-background="synthwave1"] .mountains-v1 {
  bottom: 49.8%;
  height: 14.4%;
  opacity: 0.98;
  filter: saturate(1.22) contrast(1.08) drop-shadow(0 0 8px rgba(255, 46, 136, 0.22));
}
.synthwave-bg[data-background="synthwave1"] .mountains-v1 path {
  filter:
    drop-shadow(0 -1px 1px rgba(255, 218, 236, 0.6))
    drop-shadow(0 -3px 6px rgba(255, 46, 136, 0.5))
    drop-shadow(0 0 15px rgba(255, 46, 136, 0.24));
}
.synthwave-bg[data-background="synthwave1"] .mountains-v1 path:nth-child(1) {
  fill: #6d2aa6;
}
.synthwave-bg[data-background="synthwave1"] .mountains-v1 path:nth-child(2) {
  fill: #3c0d6e;
}
.synthwave-bg[data-background="synthwave1"] .mountains-v1 path:nth-child(3) {
  fill: #1d0538;
}

/* 山脚雾气：把山脉、地平线、水面柔和地连成一体 */
.synthwave-bg[data-background="synthwave1"] .mountain-mist {
  position: absolute;
  left: -2%;
  right: -2%;
  bottom: 49%;
  height: 9%;
  pointer-events: none;
  mix-blend-mode: screen;
  filter: blur(15px);
  background:
    radial-gradient(ellipse 72% 100% at 50% 100%, rgba(255, 46, 136, 0.34), transparent 72%),
    linear-gradient(to top, rgba(255, 94, 181, 0.18), transparent 82%);
}

/* 太阳：更大的暖色核心、外圈光晕和一圈细亮边 */
.synthwave-bg[data-background="synthwave1"] .sun-v1 {
  width: 41vmin;
  height: 41vmin;
  bottom: 45%;
  filter:
    drop-shadow(0 0 10px rgba(255, 243, 175, 0.9))
    drop-shadow(0 0 26px rgba(255, 138, 61, 0.72))
    drop-shadow(0 0 70px rgba(255, 46, 136, 0.6))
    drop-shadow(0 0 140px rgba(255, 46, 136, 0.32));
}
.synthwave-bg[data-background="synthwave1"] .sun-halo {
  filter: blur(2.4px);
  transform-origin: 100px 100px;
  animation: sunHaloPulse 5s ease-in-out infinite;
}
.synthwave-bg[data-background="synthwave1"] .sun-ring {
  opacity: 0.82;
  filter:
    drop-shadow(0 0 4px rgba(255, 243, 175, 0.9))
    drop-shadow(0 0 10px rgba(255, 138, 61, 0.68));
}

/* 网格：纵向青白、横向品红，双层霓虹比原版更锐利 */
.synthwave-bg[data-background="synthwave1"] .grid-vertical {
  background-image:
    linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.95) 0 0.9px,
      rgba(34, 227, 255, 1) 0.9px 2.1px,
      rgba(34, 227, 255, 0.25) 2.1px 3px,
      transparent 3px
    );
  filter:
    brightness(1.42)
    saturate(1.2)
    drop-shadow(0 0 3px rgba(255, 255, 255, 0.78))
    drop-shadow(0 0 8px rgba(34, 227, 255, 0.66))
    drop-shadow(0 0 20px rgba(34, 227, 255, 0.32));
}
.synthwave-bg[data-background="synthwave1"] .grid-horizontal {
  background-image:
    linear-gradient(
      to bottom,
      rgba(255, 255, 255, 0.9) 0 0.9px,
      rgba(255, 94, 181, 1) 0.9px 2.1px,
      rgba(255, 46, 136, 0.26) 2.1px 3px,
      transparent 3px
    );
  filter:
    brightness(1.36)
    saturate(1.24)
    drop-shadow(0 0 3px rgba(255, 255, 255, 0.72))
    drop-shadow(0 0 8px rgba(255, 46, 136, 0.72))
    drop-shadow(0 0 20px rgba(255, 46, 136, 0.34));
}

/* 中央视线：一条从地平线延伸到镜头的光轴，增强透视纵深 */
.synthwave-bg[data-background="synthwave1"] .grid-axis {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 2px;
  pointer-events: none;
  transform: translateX(-50%);
  opacity: 0.86;
  background: linear-gradient(
    to bottom,
    rgba(255, 255, 255, 0.95) 0%,
    rgba(34, 227, 255, 0.86) 24%,
    rgba(255, 46, 136, 0.78) 62%,
    rgba(255, 46, 136, 0.16) 100%
  );
  box-shadow:
    0 0 6px rgba(255, 255, 255, 0.82),
    0 0 15px rgba(34, 227, 255, 0.7),
    0 0 34px rgba(255, 46, 136, 0.46);
  -webkit-mask-image: linear-gradient(to bottom, transparent 0%, #000 8%, #000 100%);
  mask-image: linear-gradient(to bottom, transparent 0%, #000 8%, #000 100%);
}

/* 水面：地平线附近更暖，向下过渡到深空紫黑 */
.synthwave-bg[data-background="synthwave1"] .water {
  background:
    radial-gradient(ellipse 46% 34% at 50% 0%, rgba(255, 46, 136, 0.36), transparent 70%),
    linear-gradient(
      180deg,
      #4a103f 0%,
      #2b0933 9%,
      #17062e 32%,
      #0e0329 62%,
      #04000e 100%
    );
}
.synthwave-bg[data-background="synthwave1"] .water-horizon-glow {
  position: absolute;
  left: 0;
  right: 0;
  top: -1px;
  height: 3px;
  z-index: 4;
  pointer-events: none;
  opacity: 0.88;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(255, 255, 255, 0.9) 24%,
    #ffb3d4 50%,
    rgba(255, 255, 255, 0.9) 76%,
    transparent 100%
  );
  box-shadow:
    0 0 10px rgba(255, 255, 255, 0.8),
    0 0 28px rgba(255, 46, 136, 0.82),
    0 0 60px rgba(34, 227, 255, 0.34);
}

/* 倒影：提高一点对比和饱和度，让水面里的太阳/山脉更清楚 */
.synthwave-bg[data-background="synthwave1"] .water-surface {
  -webkit-mask-image: linear-gradient(
    to bottom,
    rgba(0, 0, 0, 1) 0%,
    rgba(0, 0, 0, 0.92) 5%,
    rgba(0, 0, 0, 0.62) 32%,
    rgba(0, 0, 0, 0.28) 64%,
    transparent 96%
  );
  mask-image: linear-gradient(
    to bottom,
    rgba(0, 0, 0, 1) 0%,
    rgba(0, 0, 0, 0.92) 5%,
    rgba(0, 0, 0, 0.62) 32%,
    rgba(0, 0, 0, 0.28) 64%,
    transparent 96%
  );
}
.synthwave-bg[data-background="synthwave1"] .water-reflection {
  opacity: 0.66;
  filter: saturate(1.36) contrast(1.1) brightness(1.12) blur(0.25px);
}
.synthwave-bg[data-background="synthwave1"] .refl-sun {
  filter:
    drop-shadow(0 0 10px rgba(255, 138, 61, 0.52))
    drop-shadow(0 0 26px rgba(255, 46, 136, 0.3));
}

/* 水面焦散：透明高光斑块随水波缓慢移动 */
.synthwave-bg[data-background="synthwave1"] .water-caustics {
  position: absolute;
  inset: -8% -6%;
  pointer-events: none;
  opacity: 0.3;
  mix-blend-mode: screen;
  background-image:
    radial-gradient(ellipse 8% 5% at 22% 16%, rgba(255, 255, 255, 0.34), transparent 68%),
    radial-gradient(ellipse 10% 5% at 74% 32%, rgba(255, 255, 255, 0.28), transparent 68%),
    radial-gradient(ellipse 7% 4% at 46% 62%, rgba(190, 235, 255, 0.3), transparent 68%),
    radial-gradient(ellipse 12% 6% at 84% 74%, rgba(255, 138, 61, 0.22), transparent 70%),
    repeating-linear-gradient(
      98deg,
      transparent 0 22px,
      rgba(255, 255, 255, 0.045) 30px,
      transparent 44px,
      transparent 66px
    );
  background-size:
    100% 100%,
    100% 100%,
    100% 100%,
    100% 100%,
    180% 180%;
  animation: waterCaustics 13s linear infinite;
}

/* 太阳在水面的光柱：从地平线向下扩散，越靠近镜头越淡 */
.synthwave-bg[data-background="synthwave1"] .water-light-column {
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 13%;
  pointer-events: none;
  mix-blend-mode: screen;
  opacity: 0.52;
  transform: translateX(-50%);
  filter: blur(10px);
  background: linear-gradient(
    to bottom,
    rgba(255, 243, 175, 0.48) 0%,
    rgba(255, 138, 61, 0.34) 14%,
    rgba(255, 46, 136, 0.24) 38%,
    rgba(255, 46, 136, 0.06) 72%,
    transparent 100%
  );
  -webkit-mask-image: linear-gradient(to bottom, #000 0%, rgba(0, 0, 0, 0.88) 50%, transparent 100%);
  mask-image: linear-gradient(to bottom, #000 0%, rgba(0, 0, 0, 0.88) 50%, transparent 100%);
  animation: lightColumn 6.5s ease-in-out infinite;
}

/* 波光：比原版更明显，但保持 screen 混合，不遮挡前景 */
.synthwave-bg[data-background="synthwave1"] .water-glints {
  opacity: 0.38;
  background-image:
    repeating-linear-gradient(
      104deg,
      transparent 0 16px,
      rgba(255, 255, 255, 0.14) 22px,
      rgba(255, 255, 255, 0) 34px,
      transparent 52px
    ),
    repeating-linear-gradient(
      76deg,
      transparent 0 24px,
      rgba(180, 240, 255, 0.1) 34px,
      rgba(180, 240, 255, 0) 48px,
      transparent 70px
    );
  animation-duration: 6.5s;
}

/* 地平线高光：强调天空与水面之间那条明亮的切割线 */
.synthwave-bg[data-background="synthwave1"] .horizon-glow-v1 {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 49.8%;
  height: 4px;
  z-index: 5;
  pointer-events: none;
  background: linear-gradient(
    90deg,
    transparent 0%,
    rgba(255, 255, 255, 0.88) 30%,
    #ffd1e8 50%,
    rgba(255, 255, 255, 0.88) 70%,
    transparent 100%
  );
  box-shadow:
    0 0 16px rgba(255, 46, 136, 0.92),
    0 0 46px rgba(255, 46, 136, 0.54),
    0 0 84px rgba(34, 227, 255, 0.3);
}

/* 水面整体压暗略减，保留底部深邃但让霓虹更透 */
.synthwave-bg[data-background="synthwave1"] .water-shade {
  background:
    linear-gradient(to bottom, rgba(10, 1, 24, 0.02) 0%, rgba(10, 1, 24, 0.17) 30%, rgba(10, 1, 24, 0.58) 100%);
}

/* synthwave1 的暗角更克制，让地平线亮度集中在画面中部 */
.synthwave-bg[data-background="synthwave1"] .vignette {
  background:
    radial-gradient(
      ellipse 132% 88% at 50% 50%,
      transparent 52%,
      rgba(5, 0, 15, 0.22) 78%,
      rgba(3, 0, 10, 0.68) 100%
    ),
    linear-gradient(
      to bottom,
      rgba(3, 0, 11, 0.58) 0%,
      transparent 16%,
      transparent 76%,
      rgba(3, 0, 11, 0.54) 100%
    );
}

@keyframes starTwinkleV1 {
  0%,
  100% {
    opacity: 0.18;
    transform: scale(0.88);
  }
  50% {
    opacity: calc(var(--star-max, 0.5) + 0.28);
    transform: scale(1.62);
  }
}

@keyframes nebulaDrift {
  from {
    transform: translate3d(-1.5%, 0, 0) scale(1);
  }
  to {
    transform: translate3d(1.5%, 1.5%, 0) scale(1.06);
  }
}

@keyframes auroraShift {
  from {
    transform: skewX(-9deg) translateX(-2.5%);
    opacity: 0.24;
  }
  to {
    transform: skewX(-5deg) translateX(2.5%);
    opacity: 0.42;
  }
}

@keyframes shootingStar {
  0%,
  82% {
    opacity: 0;
    transform: translate3d(0, 0, 0) rotate(-28deg) scaleX(0.2);
  }
  85% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: translate3d(-440px, 230px, 0) rotate(-28deg) scaleX(1);
  }
}

@keyframes sunHaloPulse {
  0%,
  100% {
    opacity: 0.72;
    transform: scale(0.98);
  }
  50% {
    opacity: 1;
    transform: scale(1.04);
  }
}

@keyframes waterCaustics {
  from {
    background-position:
      0 0,
      0 0,
      0 0,
      0 0,
      0 0;
  }
  to {
    background-position:
      7% 11%,
      -5% 8%,
      4% -6%,
      -8% 12%,
      58px 46px;
  }
}

@keyframes lightColumn {
  0%,
  100% {
    opacity: 0.44;
    transform: translateX(-50%) scaleX(0.92);
  }
  50% {
    opacity: 0.6;
    transform: translateX(-50%) scaleX(1.08);
  }
}
</style>

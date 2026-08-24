<script setup lang="ts">
/**
 * 图池单卡：横向长条矩形（1920×1080 画布坐标内布局，高度由父级 --row-h 指定）。
 *
 * 构成：背景图（logo_url cover；无自定义图时按名称回退官方关卡背景
 * pickDefaultBg，再无 / 加载失败回退类别色底）+ 左侧高对比
 * 类别色块 + 居中标题（名称严格居中；重试次数「xN」小字挂标题
 * 右沿独立显示，不挤偏标题）。
 * CT 候选词条集中展示在 CT 类别下方的词条板（见 CtTagBoard.vue）；被 pick
 * 的 CT 选图在卡右下角持久横排展示携带词条（pick 方选手色、文本真镂空
 * 透出卡片背景，做法同词条板；不随回合重置）。
 *
 * BP 三态（选手色 --pc / 辉光 --pc-glow 由 side 类内联提供）：
 * - ban：内容统一大幅变暗 + 选手色亮边框 + 右下角向内切角三角形内禁止图标；
 * - protect：仅右上角护盾切角角标（无边框无辉光；整场有效，该选图之后被 pick
 *   时角标保留并与 pick 边框叠加，配色用 protect 方选手色）；
 * - pick：选手色边框；新被选中瞬间高亮闪烁数次后回落常亮微辉。
 */
import { computed, onUnmounted, ref, watch, withDefaults } from "vue";

import type { CategoryKind, Pick } from "@/api/types";
import { categoryKindInfo } from "@/utils/format";
import { categoryBgFallback, categoryTagBg, pickDefaultBg } from "@/utils/mappool";
import type { PickCardStatus } from "./useDraftStatus";

const props = withDefaults(
  defineProps<{
    pick: Pick;
    kind: CategoryKind;
    /** BP 终态（null = 中性） */
    status: PickCardStatus | null;
    /** protect 方（整场有效；null = 未被 protect） */
    protectedBy: "A" | "B" | null;
    /** 重试次数（draft 指定值优先，回退 pick.retry_count；由父级经 retryOf 解析） */
    retry: number | null;
    /** 本卡被 pick 时携带的词条（仅 CT；整场持久显示，不随回合重置） */
    pickedTags: string[];
  }>(),
  { pickedTags: () => [] },
);

const kindShort = computed(() => categoryKindInfo(props.kind)?.short ?? props.kind);

/** 背景图：自定义展示图优先，否则按选图名称回退官方关卡默认背景 */
const logoSrc = computed(() => props.pick.logo_url ?? pickDefaultBg(props.pick));
/** 图片加载失败（网络/对象缺失）→ 回退占位 */
const imgFailed = ref(false);
const showImage = computed(() => !!logoSrc.value && !imgFailed.value);

/** 类别 → 左侧色块底色（高对比亮色，区别于占位底的暗色系；映射见 utils/mappool） */
const tagBg = computed<string>(() => categoryTagBg(props.kind));
const tagDark = computed(() => props.kind === "TB"); // 金底配深字

/** 类别 → 占位底色（无图回退；映射见 utils/mappool） */
const bgColor = computed<string>(() => categoryBgFallback(props.kind));

const stKind = computed(() => props.status?.kind ?? null);
const sideClass = computed(() =>
  props.status ? (props.status.by === "A" ? "by-a" : "by-b") : null,
);
/** protect 方 → 角标配色类（--prot 与终态 --pc 独立：protect 方与 pick 方可能不同） */
const protClass = computed(() =>
  props.protectedBy ? (props.protectedBy === "A" ? "prot-a" : "prot-b") : null,
);

/** SVG mask id（词条名 slug；前缀 kmc- 区别于词条板的 kmt-，避免同文档 id 冲突） */
function maskId(tg: string): string {
  return `kmc-${tg.replace(/[^a-zA-Z0-9]+/g, "-")}`;
}

// ---- pick 闪烁：状态「新变为」pick 时脉冲数次（动画结束回落常亮） ----
const flashing = ref(false);
let flashTimer: ReturnType<typeof setTimeout> | null = null;
watch(
  () => props.status,
  (nv, ov) => {
    if (nv?.kind === "pick" && ov?.kind !== "pick") {
      if (flashTimer) clearTimeout(flashTimer);
      flashing.value = false;
      // 双 rAF 确保类先移除再重加，连续触发也能重播动画
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          flashing.value = true;
          flashTimer = setTimeout(() => (flashing.value = false), 1700);
        }),
      );
    }
  },
);
onUnmounted(() => {
  if (flashTimer) clearTimeout(flashTimer);
});
</script>

<template>
  <div class="card" :class="[stKind && `st-${stKind}`, sideClass, protClass, { flashing }]">
    <!-- 内容层（ban 时整体变暗；边框/切角在外层保持亮色） -->
    <div class="content" :style="{ background: showImage ? '#000' : bgColor }">
      <img v-if="showImage" :src="logoSrc!" :alt="pick.name" @error="imgFailed = true" />

      <div class="cat" :class="{ dark: tagDark }" :style="{ background: tagBg }">
        {{ kindShort }}
      </div>

      <div class="text">
        <div class="title-row">
          <span class="name-wrap">
            <span class="name">{{ pick.name }}</span>
            <span v-if="retry != null" class="retry">x{{ retry }}</span>
          </span>
        </div>
      </div>
    </div>

    <!-- ban：右下角向内切角三角形 + 禁止图标 -->
    <div v-if="stKind === 'ban'" class="notch">
      <svg class="no-icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="2.8" />
        <line x1="6.2" y1="6.2" x2="17.8" y2="17.8" stroke="currentColor" stroke-width="2.8" />
      </svg>
    </div>

    <!-- protect：右上角护盾角标（整场有效，不随终态消失） -->
    <div v-if="protectedBy" class="shield">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 2l8 3v6c0 5-3.4 9.3-8 11-4.6-1.7-8-6-8-11V5l8-3z"
          fill="currentColor"
        />
      </svg>
    </div>

    <!-- 被 pick 的 CT 选图携带的词条：右下角横排小胶囊整场持久显示
         （pick 方选手色，文本 SVG mask 真镂空——孔内直接透出卡片背景） -->
    <div v-if="pickedTags.length" class="picked-tags">
      <span v-for="tg in pickedTags" :key="tg" class="ptag">
        <svg class="knock" aria-hidden="true">
          <defs>
            <mask :id="maskId(tg)" maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%">
              <rect x="0" y="0" width="100%" height="100%" fill="#fff" />
              <text
                class="knock-text"
                x="50%"
                y="50%"
                text-anchor="middle"
                dominant-baseline="central"
                fill="#000"
              >
                {{ tg }}
              </text>
            </mask>
          </defs>
          <rect
            class="knock-fill"
            x="0"
            y="0"
            width="100%"
            height="100%"
            :mask="`url(#${maskId(tg)})`"
          />
        </svg>
        <span class="txt">{{ tg }}</span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.card {
  --card-h: calc(var(--row-h, 96px) * 0.75); /* 标题文本（0.45×行高×1.2 行距）+ 均匀余量 */
  position: relative;
  width: var(--card-w, 100%);
  height: var(--card-h);
  border-radius: 0;
  border: none;
  overflow: hidden;
  flex-shrink: 0;
}

/* ---- 选手色：终态边框/角标（--pc）与 protect 护盾（--prot）各自独立 ---- */
.card.by-a,
.card.prot-a {
  --pc: var(--syn-a);
  --pc-glow: rgba(61, 139, 255, 0.55);
  --prot: var(--syn-a);
}
.card.by-b,
.card.prot-b {
  --pc: var(--syn-b);
  --pc-glow: rgba(255, 107, 74, 0.55);
  --prot: var(--syn-b);
}
.card.st-ban,
.card.st-pick {
  box-shadow: 0 0 16px var(--pc-glow);
}
/* 内边框：覆盖层沿卡片边缘向内描 5px，不占卡片外尺寸、盖在内容之上。
   显式 z-index 高于 .cat/.text 的 2——否则闪烁动画结束后 filter 移除、
   内容层不再是层叠上下文，类别标签会反过来盖住边框 */
.card.st-ban::after,
.card.st-pick::after {
  content: "";
  position: absolute;
  inset: 0;
  border: 5px solid var(--pc);
  pointer-events: none;
  z-index: 5;
}

/* ---- 内容层 ---- */
.content {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: stretch;
  overflow: hidden;
  transition: filter 0.35s ease;
}
.content img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
/* 文字可读性：整卡深色遮罩（标题居中，四侧都压暗） */
.content::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, rgba(5, 0, 15, 0.5) 0%, rgba(5, 0, 15, 0.3) 50%, rgba(5, 0, 15, 0.5) 100%);
  pointer-events: none;
}
.card.st-ban .content {
  filter: brightness(0.32) saturate(0.35);
}

/* ---- 左侧类别色块 ---- */
.cat {
  position: relative;
  z-index: 2;
  width: var(--card-h); /* 类别块随卡片高收窄成正方 */
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: calc(var(--row-h, 96px) * 0.3);
  font-weight: 900;
  letter-spacing: 1px;
  color: #fff;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
}
.cat.dark {
  color: #1a0b02;
  text-shadow: none;
}

/* ---- 文本区（标题居中） ---- */
.text {
  position: relative;
  z-index: 2;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 0 calc(var(--row-h, 96px) * 0.16);
}
.title-row {
  display: flex;
  justify-content: center;
  min-width: 0;
  line-height: 1.2;
}
/* 名称盒按内容宽参与居中（标题真正居中不被 attempts 挤偏），超宽自身截断 */
.name-wrap {
  display: flex;
  /* flex 基线对齐取各子项行内真实文字基线——inline-block + overflow:hidden
     的合成基线是盒底边，会把 attempts 拉到标题盒底 */
  align-items: baseline;
  max-width: 100%;
  min-width: 0;
  white-space: nowrap;
}
.name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: calc(var(--row-h, 96px) * 0.45);
  font-weight: 800;
  color: var(--syn-text);
}
/* 重试次数：零宽 flex 项参与基线对齐（字形底随字体度量精确一致），文本向
   右溢出可见；负右 margin 抵消占位，标题居中不受影响。小号浅灰注释体 */
.retry {
  flex-shrink: 0;
  width: 0;
  margin-left: 0.45em;
  margin-right: -0.45em;
  font-size: calc(var(--row-h, 96px) * 0.25);
  font-weight: 600;
  color: var(--syn-text-dim);
  white-space: nowrap;
}

/* ---- pick 闪烁：只闪内容层，边框保持稳定 ---- */
.card.flashing .content {
  animation: pick-flash 1.6s ease-out;
}
@keyframes pick-flash {
  0%,
  100% {
    filter: brightness(1);
  }
  10%,
  26%,
  42% {
    filter: brightness(2.1) saturate(1.4);
  }
  18%,
  34%,
  50% {
    filter: brightness(1.05);
  }
}

/* ---- ban 右下切角三角 + 禁止图标：斜边严格 45°，上端起自卡片右上角、
   落到卡片底部（方形盒宽=高=卡片高，斜边在盒内天然 45°） ---- */
.notch {
  position: absolute;
  top: 0;
  right: 0;
  width: var(--card-h);
  height: 100%;
  background: var(--pc);
  clip-path: polygon(100% 0, 100% 100%, 0 100%);
  z-index: 7; /* 高于内边框 z-5 与其余图层，切角整体盖在边框之上 */
}
/* 图标中心 = 直角三角形重心（距两直角边各 1/3 边长；23% = 图标半宽 46%/2） */
.no-icon {
  position: absolute;
  right: calc(100% / 3 - 23%);
  bottom: calc(100% / 3 - 23%);
  width: 46%;
  height: 46%;
  color: #0a0118;
  z-index: 8;
}

/* ---- protect 护盾角标：斜边严格 45°，下端起自卡片右下角、反向落到卡片
   顶部（与 ban 切角同尺寸方形盒，clip 方向镜像） ---- */
.shield {
  position: absolute;
  top: 0;
  right: 0;
  width: var(--card-h);
  height: 100%;
  background: var(--prot);
  clip-path: polygon(0 0, 100% 0, 100% 100%);
  z-index: 7; /* 高于内边框 z-5 与其余图层，pick 后角标叠在边框之上 */
}
/* 图标中心 = 直角三角形重心（同 ban 图标，方向朝右上角） */
.shield svg {
  position: absolute;
  top: calc(100% / 3 - 23%);
  right: calc(100% / 3 - 23%);
  width: 46%;
  height: 46%;
  color: #0a0118;
  z-index: 8;
}

/* ---- 当前回合 pick 词条（CT）：右下角横向小胶囊，底色用 pick 方选手色
   （--pc 由 pick 状态的 side 类提供；层序高于内边框 z-5、低于切角角标 z-7）。
   胶囊形由 CSS 圆角裁剪 SVG 得到（rect 不带 rx，缘由见词条板同类注释）；
   文本 span 转隐形 ghost 只负责撑尺寸 ---- */
.picked-tags {
  position: absolute;
  right: calc(var(--row-h, 96px) * 0.07);
  bottom: calc(var(--row-h, 96px) * 0.06);
  display: flex;
  gap: calc(var(--row-h, 96px) * 0.08);
  z-index: 6;
  pointer-events: none;
}
.ptag {
  position: relative;
  padding: 0.08em 0.55em;
  border-radius: 999px;
  /* 与词条板 .tag 同字号（0.27×行高），角标与板上词条等大 */
  font-size: calc(var(--row-h, 96px) * 0.27);
  font-weight: 800;
  line-height: 1.25;
  white-space: nowrap;
}
.ptag .txt {
  visibility: hidden;
}
/* svg 是替换元素：尺寸必须显式给，只写 inset 不拉伸（回落固有 300×150） */
.knock {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  border-radius: 999px;
  overflow: hidden;
  pointer-events: none;
}
.knock-fill {
  fill: var(--pc);
}
.knock-text {
  font-family: inherit;
  font-size: calc(var(--row-h, 96px) * 0.27);
  font-weight: 800;
}
</style>

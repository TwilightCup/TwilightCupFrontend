<script setup lang="ts">
/**
 * 比赛详情场景左下角的当前选图角标卡：裁判宣布选图（pick_announced）后常驻
 * 展示本回合选图，直至下一次选图替换。视觉语言对齐图池场景的 MapCard——
 * 背景图回退链（logo → 官方关卡默认图 → 类别色底）、左侧类别色块、pick 方
 * 选手色边框与辉光、CT 词条镂空胶囊、重试次数——但按左下角空间改为窄高
 * 比例：标题空间不足折行（至多 3 行，超出截断），类别条与词条胶囊等比缩小。
 * 尺寸由外层包裹元素给定（本组件 100% 填充）。
 *
 * side 未知（draft 广播未跟上 pick_announced 的短暂窗口）时边框/词条暂以
 * 中性色显示，draft 到达后反应式切换为选手色。
 */
import { computed, ref } from "vue";

import type { CategoryKind, Pick } from "@/api/types";
import { categoryKindInfo } from "@/utils/format";
import { categoryBgFallback, categoryTagBg, pickDefaultBg } from "@/utils/mappool";

const props = defineProps<{
  pick: Pick;
  kind: CategoryKind | null;
  /** pick 方（选手色边框 / 词条底色）；null = 未知，暂以中性色兜底 */
  side: "A" | "B" | null;
  /** 重试次数（draft 指定值优先的解析由父级完成） */
  retry: number | null;
  /** 携带的词条（仅 CT 选图，父级门控后传入） */
  tags: string[];
}>();

const kindShort = computed(() => categoryKindInfo(props.kind)?.short ?? props.kind ?? "");

/** 背景图回退链与 MapCard 同口径：自定义展示图 → 官方关卡默认背景 → 类别色底 */
const logoSrc = computed(() => props.pick.logo_url ?? pickDefaultBg(props.pick));
const imgFailed = ref(false);
const showImage = computed(() => !!logoSrc.value && !imgFailed.value);

const tagBg = computed(() => categoryTagBg(props.kind));
const bgColor = computed(() => categoryBgFallback(props.kind));
const tagDark = computed(() => props.kind === "TB"); // 金底配深字（同 MapCard）

const sideClass = computed(() =>
  props.side === "A" ? "by-a" : props.side === "B" ? "by-b" : null,
);

/** SVG mask id（词条名 slug；前缀 kmp- 区别于词条板 kmt- / 图池卡 kmc-） */
function maskId(tg: string): string {
  return `kmp-${tg.replace(/[^a-zA-Z0-9]+/g, "-")}`;
}
</script>

<template>
  <div class="pcard" :class="sideClass">
    <!-- 内容层（边框/胶囊在外层保持亮色） -->
    <div class="content" :style="{ background: showImage ? '#000' : bgColor }">
      <img v-if="showImage" :src="logoSrc!" :alt="pick.name" @error="imgFailed = true" />

      <div class="cat" :class="{ dark: tagDark }" :style="{ background: tagBg }">
        {{ kindShort }}
      </div>

      <div class="text">
        <!-- 标题折行：窄高比例下长关名自然换行（至多 3 行），重试次数随行内缀。
             xN 前用 nbsp（不可断空格）与标题末词/末字绑定为不可断单元——折行时
             整体换行，xN 永不单独成行（其所在行必有标题文字） -->
        <div class="title">
          {{ pick.name }}<span v-if="retry != null" class="retry">&nbsp;x{{ retry }}</span>
        </div>
      </div>
    </div>

    <!-- CT 选图携带的词条：右下角垂直堆叠小胶囊（pick 方选手色，文本 SVG mask
         真镂空——孔内直接透出卡片背景，做法同图池卡） -->
    <div v-if="tags.length" class="ptags">
      <span v-for="tg in tags" :key="tg" class="ptag">
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
/* 选手色（--pc/--pc-glow）：side 未知的短暂窗口用中性色兜底 */
.pcard {
  --pc: rgba(255, 255, 255, 0.55);
  --pc-glow: transparent;
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  box-shadow: 0 0 18px var(--pc-glow);
}
.pcard.by-a {
  --pc: var(--syn-a);
  --pc-glow: rgba(61, 139, 255, 0.55);
}
.pcard.by-b {
  --pc: var(--syn-b);
  --pc-glow: rgba(255, 107, 74, 0.55);
}
/* 内边框：沿卡片边缘向内描 4px，不占卡片外尺寸、盖在内容之上（同图池卡口径） */
.pcard::after {
  content: "";
  position: absolute;
  inset: 0;
  border: 4px solid var(--pc);
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
}
.content img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
/* 文字可读性：整卡深色遮罩（标题贴左下，四侧都压暗） */
.content::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    rgba(5, 0, 15, 0.5) 0%,
    rgba(5, 0, 15, 0.3) 50%,
    rgba(5, 0, 15, 0.5) 100%
  );
  pointer-events: none;
}

/* ---- 左侧类别色块：窄条（非图池卡的正方，窄高比例下只占少量宽） ---- */
.cat {
  position: relative;
  z-index: 2;
  width: 12%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: clamp(13px, 2.1vh, 24px);
  font-weight: 900;
  letter-spacing: 1px;
  color: #fff;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
}
.cat.dark {
  color: #1a0b02;
  text-shadow: none;
}

/* ---- 标题（左对齐：左侧贴类别标签、底部贴卡片底边，空出内边框宽度） ---- */
.text {
  position: relative;
  z-index: 2;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: 0 1.6vh 4px 0.8vh;
  text-align: left;
}
.title {
  /* 字号随卡高折算：3 行 × 1.18 行高恰好填满卡内高（扣 4px 底部空边框量），
     卡高由锚定量测注入 → 字号随计时器几何同步缩放 */
  font-size: calc((100cqh - 4px) / 3.54);
  font-weight: 800;
  color: var(--syn-text);
  line-height: 1.18;
  word-break: break-word;
  /* 至多 3 行（正好满高），更长的关名尾部截断（角标空间有限） */
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  overflow: hidden;
}
/* 重试次数：随标题行内缀的小号浅灰注释体（0.55em 同比随标题缩放） */
.retry {
  font-size: 0.55em;
  font-weight: 600;
  color: var(--syn-text-dim);
}

/* ---- 词条胶囊（CT）：右下角垂直堆叠，底色用 pick 方选手色，文本 SVG mask
       真镂空（层序高于内边框 z-5）；胶囊形由 CSS 圆角裁剪 SVG，文本 span 撑尺寸 ---- */
.ptags {
  --tag-fs: clamp(11px, 1.7vh, 18px);
  position: absolute;
  right: 1.3vh;
  bottom: 1.1vh;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.8vh;
  z-index: 6;
  pointer-events: none;
}
.ptag {
  position: relative;
  padding: 0.08em 0.55em;
  border-radius: 999px;
  font-size: var(--tag-fs);
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
  font-size: var(--tag-fs);
  font-weight: 800;
}
</style>

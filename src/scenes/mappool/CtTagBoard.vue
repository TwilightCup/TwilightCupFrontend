<script setup lang="ts">
/**
 * CT 词条板：整个 CT 类别下方的一条横幅卡，集中展示候选词条及其 BP 状态
 * （词条不渲染进各选图卡）。
 *
 * - 被 ban（TAG_BAN 环节，整场有效）：新 ban 时播一次划线划过动画，终态整体
 *   变暗保持删除划线，但划线本身用 ban 方选手色（不随胶囊变灰）；
 * - 当前回合 pick 携带：亮色胶囊（选手色）+ 真镂空文字（SVG mask 挖孔，
 *   孔内直接透出半透明板与背景动画）；
 * - 其余默认。回合重置由父级只传 activePick 的 tags 实现（新回合自动回默认）。
 */
import { computed, onUnmounted, ref, watch } from "vue";

const props = defineProps<{
  /** 候选词条（CT_TAG_BASE + 单关含 Achievement） */
  candidates: string[];
  /** 整场被 ban 的词条 */
  bannedTags: string[];
  /** 各方 ban 的词条（划线按选手色） */
  tagBanBy: { A: string | null; B: string | null };
  /** 当前回合 pick 携带的高亮词条 */
  pickedTags: string[];
  /** 当前回合 pick 方（胶囊着色；null 中性） */
  pickSide: "A" | "B" | null;
}>();

// ---- 词条被 ban：新出现的划线动画（播一次后保持划线变暗态） ----
const striking = ref<Set<string>>(new Set());
const strikeTimers = new Map<string, ReturnType<typeof setTimeout>>();
watch(
  () => props.bannedTags,
  (nv = [], ov = []) => {
    for (const t of nv) {
      if (ov.includes(t) || strikeTimers.has(t)) continue;
      striking.value.add(t);
      strikeTimers.set(
        t,
        setTimeout(() => {
          striking.value.delete(t);
          strikeTimers.delete(t);
        }, 700),
      );
    }
  },
);
onUnmounted(() => {
  for (const t of strikeTimers.values()) clearTimeout(t);
  strikeTimers.clear();
});

function tagState(tg: string): "banned" | "picked" | null {
  if (props.bannedTags.includes(tg)) return "banned";
  if (props.pickedTags.includes(tg)) return "picked";
  return null;
}

/** 该词条是被哪一方 ban 的（A/B；未知回 null → 划线用品红兜底色） */
function banSideOf(tg: string): "A" | "B" | null {
  if (props.tagBanBy.A === tg) return "A";
  if (props.tagBanBy.B === tg) return "B";
  return null;
}

/** ban 方 → CSS 类名。必须转小写：CSS 类选择器大小写敏感，draft 的 Side 是大写 A/B */
function banClass(tg: string): string | null {
  const s = banSideOf(tg);
  return s ? `ban-by-${s.toLowerCase()}` : null;
}

/** 固定分两排显示（上排多一个），各自水平居中 */
const row1 = computed(() => props.candidates.slice(0, Math.ceil(props.candidates.length / 2)));
const row2 = computed(() => props.candidates.slice(Math.ceil(props.candidates.length / 2)));

/** SVG mask id（词条名做 slug，同一板上唯一；含空格的词条不能直接进 id） */
function maskId(tg: string): string {
  return `kmt-${tg.replace(/[^a-zA-Z0-9]+/g, "-")}`;
}
</script>

<template>
  <div
    class="tag-board"
    :class="pickSide === 'A' ? 'by-a' : pickSide === 'B' ? 'by-b' : null"
  >
    <div class="tag-line">
      <span
        v-for="tg in row1"
        :key="tg"
        class="tag"
        :class="[tagState(tg), banClass(tg), { striking: striking.has(tg) }]"
      >
        <!-- 被 pick：SVG 胶囊 + 文本作 mask 挖真孔（孔内透出半透明板与背景） -->
        <svg v-if="tagState(tg) === 'picked'" class="knock" aria-hidden="true">
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
        <span class="txt" :class="{ ghost: tagState(tg) === 'picked' }">{{ tg }}</span>
      </span>
    </div>
    <div v-if="row2.length" class="tag-line">
      <span
        v-for="tg in row2"
        :key="tg"
        class="tag"
        :class="[tagState(tg), banClass(tg), { striking: striking.has(tg) }]"
      >
        <svg v-if="tagState(tg) === 'picked'" class="knock" aria-hidden="true">
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
        <span class="txt" :class="{ ghost: tagState(tg) === 'picked' }">{{ tg }}</span>
      </span>
    </div>
  </div>
</template>

<style scoped>
/* 胶囊形背景：宽度自适应刚好包住全部词条（上宽行决定），限不超出内容宽；
   高度包住两排词条 + 余量（两排 ≈ 0.70×行高 + 行距 + 边框） */
.tag-board {
  width: fit-content;
  max-width: 100%;
  height: calc(var(--row-h, 96px) * 0.92);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: calc(var(--row-h, 96px) * 0.08);
  padding: 0 calc(var(--row-h, 96px) * 0.45);
  border-radius: 999px;
  border: 2px solid var(--syn-border);
  /* 半透明：背景动画隐约透出，配合被 pick 词条的真镂空开孔 */
  background: var(--syn-panel);
}

/* 选手色（被 pick 词条胶囊用） */
.tag-board.by-a {
  --pc: var(--syn-a);
}
.tag-board.by-b {
  --pc: var(--syn-b);
}

.tag-line {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: calc(var(--row-h, 96px) * 0.1);
}
.tag {
  position: relative;
  font-size: calc(var(--row-h, 96px) * 0.27);
  font-weight: 600;
  line-height: 1.3;
  padding: 0 0.7em;
  border-radius: 999px;
  background: rgba(255, 46, 136, 0.16);
  border: 1px solid var(--syn-magenta);
  color: #ffb3d4;
  white-space: nowrap;
  /* 只淡文字/边框/底色（不用元素级 opacity，那会把划线一起压暗） */
  transition: color 0.4s ease, border-color 0.4s ease, background 0.4s ease;
}
/* 被 ban：胶囊变暗；划线统一由 ::after 绘制（动画扫入与终态同一条线，
   位置/长度天然一致；颜色为 ban 方选手色，不随胶囊变灰） */
.tag.banned {
  color: var(--syn-text-dim);
  border-color: var(--syn-border);
  background: rgba(120, 80, 200, 0.1);
}
.tag.banned::after {
  content: "";
  position: absolute;
  left: 4%;
  right: 4%;
  top: calc(50% - var(--row-h, 96px) * 0.015);
  height: calc(var(--row-h, 96px) * 0.03);
  background: var(--syn-magenta);
  border-radius: 999px;
}
.tag.banned.ban-by-a::after {
  background: var(--syn-a);
}
.tag.banned.ban-by-b::after {
  background: var(--syn-b);
}
/* 新 ban：同一条线从左扫入定格（striking 移除后由上面的静态规则无缝接管） */
.tag.striking::after {
  transform: scaleX(0);
  transform-origin: left center;
  animation: tag-strike 0.45s ease forwards;
}
@keyframes tag-strike {
  to {
    transform: scaleX(1);
  }
}
/* 被 pick：SVG 层画胶囊并用文本 mask 挖真孔——胶囊底透明，孔内直接透出板与背景。
   文本 span 转隐形 ghost 仅负责撑尺寸；边框转透明只留宽度（与其他态同尺寸不抖动），
   胶囊轮廓完全由 SVG 层绘制（外沿即原边框外沿，无缩进缝隙） */
.tag.picked {
  background: transparent;
  border-color: transparent;
  color: transparent;
}
.txt.ghost {
  visibility: hidden;
}
/* 胶囊形由 CSS 圆角裁剪 SVG 得到：SVG rect 的 rx/ry 各自独立钳位（999 → w/2 与
   h/2），宽扁矩形会退化成内切椭圆、四个圆角填不满；CSS border-radius 按比例
   缩放才是真胶囊，故 rect 不带 rx、整块填满后在此裁形。
   左上角 -1px + calc 尺寸铺到边框盒（外沿 = 原边框外沿，无缝隙）；尺寸必须
   显式给——svg 是替换元素，只写 inset 不会拉伸，会回落到固有尺寸 300×150 */
.knock {
  position: absolute;
  left: -1px;
  top: -1px;
  width: calc(100% + 2px);
  height: calc(100% + 2px);
  border-radius: 999px;
  overflow: hidden;
  pointer-events: none;
}
.knock-fill {
  fill: var(--pc, var(--syn-cyan));
}
.knock-text {
  font-family: inherit;
  font-size: calc(var(--row-h, 96px) * 0.27);
  font-weight: 800;
}
</style>

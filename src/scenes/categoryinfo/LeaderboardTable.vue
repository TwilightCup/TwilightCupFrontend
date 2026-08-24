<script setup lang="ts">
/**
 * 项目信息场景的 Top 15 榜单（单个霓虹 panel，紧凑排布）。
 *
 * 行 = 名次（1-3 奖牌色）/ 选手名 / 成绩（等宽数字）/ 成绩日期（YY-MM-DD，
 * 成绩右侧、弱化小字）。本场选手高亮为**选手名着选手色 + 轻微辉光**
 * （A 蓝 / B 红）。并列名次（place 跳号）按 speedrun.com 原样展示。
 */
import { computed } from "vue";
import { formatRunTime } from "@/utils/format";
import type { CategoryRow } from "./useCategoryInfo";

const props = defineProps<{ rows: CategoryRow[] }>();

/** 榜上是否有本场选手（任一行高亮）：有则其余行的名称/成绩弱化为灰色 */
const hasHighlight = computed(() => props.rows.some((r) => r.highlight !== null));

const medal = (place: number): string => {
  if (place === 1) return "medal-gold";
  if (place === 2) return "medal-silver";
  if (place === 3) return "medal-bronze";
  return "";
};

/** "YYYY-MM-DD" → "YY-MM-DD"；缺失返回空串。 */
function shortDate(iso: string | null): string {
  return iso ? iso.slice(2, 10) : "";
}
</script>

<template>
  <div class="lb neon-panel" :class="{ 'dim-others': hasHighlight }">
    <TransitionGroup name="lb-row" tag="div" class="lb-body">
      <div
        v-for="(r, i) in props.rows"
        :key="`${r.place}-${r.playerName}-${i}`"
        class="lb-row"
        :class="[medal(r.place), r.highlight ? `hl-${r.highlight}` : '']"
      >
        <span class="lb-td rank">{{ r.place }}</span>
        <span class="lb-td player">{{ r.playerName }}</span>
        <span class="lb-td time">{{ formatRunTime(r.timeSec) }}</span>
        <span class="lb-td date">{{ shortDate(r.date) }}</span>
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
/* 一整个 panel：半透紫底 + 青描边（neon-panel），行平铺填满。
   列间距收窄（名次/名称/成绩/日期紧凑排列），宽度由外层 panel-box 限制。 */
.lb {
  flex: 1;
  min-height: 0;
  display: flex;
  padding: 12px 22px;
}
.lb-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
}
.lb-row {
  height: 46px;
  flex: none;
  display: grid;
  /* 名称列与成绩列等宽（过长名称省略号截断），列间 6px 紧凑间距 */
  grid-template-columns: 78px 210px 210px 120px;
  align-items: center;
  column-gap: 6px;
}
.lb-row + .lb-row {
  border-top: 1px solid rgba(120, 80, 200, 0.22);
}
.lb-td.rank {
  font-size: 24px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--syn-text-dim);
}
.lb-td.player {
  font-size: 24px;
  font-weight: 600;
  color: var(--syn-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lb-td.time {
  font-size: 25px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: 1px;
  text-align: right;
}
.lb-td.date {
  font-size: 17px;
  color: var(--syn-text-dim);
  font-variant-numeric: tabular-nums;
  text-align: right;
}

/* 奖牌名次色 */
.medal-gold .lb-td.rank {
  color: var(--syn-win);
  text-shadow: 0 0 10px rgba(255, 209, 102, 0.5);
}
.medal-silver .lb-td.rank {
  color: #cfd8ff;
  text-shadow: 0 0 10px rgba(207, 216, 255, 0.4);
}
.medal-bronze .lb-td.rank {
  color: var(--syn-orange);
  text-shadow: 0 0 10px rgba(255, 138, 61, 0.4);
}

/* 本场选手高亮：名称着选手色 + 轻微辉光 */
.hl-A .lb-td.player {
  color: var(--syn-a);
  text-shadow: 0 0 9px rgba(61, 139, 255, 0.55);
}
.hl-B .lb-td.player {
  color: var(--syn-b);
  text-shadow: 0 0 9px rgba(255, 107, 74, 0.55);
}

/* 榜上有本场选手时：非选手行的名称与成绩整体弱化为灰色（名次色不变）；
   榜上没有本场选手则保持默认白色 */
.dim-others .lb-row:not(.hl-A):not(.hl-B) :is(.lb-td.player, .lb-td.time) {
  color: #8b8b9e;
}

/* 换榜入场：逐行轻微上移淡入 */
.lb-row-enter-active {
  transition: all 0.35s ease;
}
.lb-row-enter-from {
  opacity: 0;
  transform: translateY(10px);
}
</style>

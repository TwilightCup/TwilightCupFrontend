<script setup lang="ts">
/**
 * 项目信息场景的 Top 15 榜单表。
 *
 * 行 = 名次（1-3 奖牌色）/ 选手名 / 成绩（等宽数字）；本场选手行以
 * 选手色（A 蓝 / B 红）左边条 + 半透色底高亮。并列名次（place 跳号）按
 * speedrun.com 原样展示。文案经 bi() 双语（不随 locale 切换）。
 */
import { computed } from "vue";
import { bi } from "@/utils/bilingual";
import { formatRunTime } from "@/utils/format";
import type { CategoryRow } from "./useCategoryInfo";

const props = defineProps<{ rows: CategoryRow[] }>();

const medal = (place: number): string => {
  if (place === 1) return "medal-gold";
  if (place === 2) return "medal-silver";
  if (place === 3) return "medal-bronze";
  return "";
};

const header = computed(() => ({
  rank: bi("scenes.categoryinfo.rankHeader"),
  player: bi("scenes.categoryinfo.playerHeader"),
  time: bi("scenes.categoryinfo.timeHeader"),
}));
</script>

<template>
  <div class="lb">
    <div class="lb-head">
      <span class="lb-th rank">{{ header.rank }}</span>
      <span class="lb-th player">{{ header.player }}</span>
      <span class="lb-th time">{{ header.time }}</span>
    </div>
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
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.lb {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lb-head,
.lb-row {
  display: grid;
  grid-template-columns: 110px 1fr 240px;
  align-items: center;
  column-gap: 16px;
}
.lb-head {
  padding: 0 22px 4px;
}
.lb-th {
  font-size: 20px;
  font-weight: 700;
  color: var(--syn-text-dim);
  letter-spacing: 2px;
}
.lb-th.time,
.lb-td.time {
  text-align: right;
}
.lb-row {
  height: 52px;
  padding: 0 22px;
  border-radius: 10px;
  background: var(--syn-panel);
  border: 1px solid var(--syn-border);
}
.lb-row + .lb-row {
  margin-top: 2px;
}
.lb-td.rank {
  font-size: 26px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: var(--syn-text-dim);
}
.lb-td.player {
  font-size: 25px;
  font-weight: 600;
  color: var(--syn-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lb-td.time {
  font-size: 26px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: 1px;
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

/* 本场选手高亮：选手色左边条 + 半透色底 */
.hl-A {
  border-color: var(--syn-a);
  background: linear-gradient(90deg, rgba(61, 139, 255, 0.22), var(--syn-panel) 55%);
  box-shadow: inset 4px 0 0 var(--syn-a), 0 0 18px rgba(61, 139, 255, 0.25);
}
.hl-B {
  border-color: var(--syn-b);
  background: linear-gradient(90deg, rgba(255, 107, 74, 0.22), var(--syn-panel) 55%);
  box-shadow: inset 4px 0 0 var(--syn-b), 0 0 18px rgba(255, 107, 74, 0.25);
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

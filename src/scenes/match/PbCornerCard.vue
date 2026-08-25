<script setup lang="ts">
/**
 * 比赛详情场景右下角的 PB 角标卡：当前项目 speedrun.com 成绩速览，数据与
 * 项目信息场景（categoryinfo）同源——世界纪录（榜首成绩）+ 双方选手该项目 PB。
 *
 * 样式对齐该场景的霓虹 panel（neon-panel）但改直角边；三行各为
 * 「标签（左，等宽）→ 时间（紧随标签，列宽 = 可见行最长文本）→ 名称（占
 * 余宽、左对齐、过长省略号）」，元素间隔与卡片水平内边距一致：标签保留行色（WR 金 = 榜单榜首
 * 名次色，PB = 选手色），时间与名称统一榜单 4 名外名次色（弱化、无辉光）。
 * WR 名称 = speedrun 榜首玩家名；PB 名称 = 选手展示名，按用时升序（短者在
 * 上，无成绩沉底）。
 * 行按数据到场逐行显示（WR 未拉到 / PB 待拉取时不占行）。尺寸由外层包裹
 * 元素给定（本组件 100% 填充），内部以 cq 单位随卡体缩放。
 */
import { computed } from "vue";

import type { SrPersonalBest } from "@/api/speedrun";
import { formatRunTime } from "@/utils/format";

const props = defineProps<{
  /** 当前项目世界纪录（榜首成绩，秒）；null = 未拉到（行隐藏） */
  wrSec: number | null;
  /** 世界纪录保持者（speedrun 玩家名）；null = 未拉到 */
  wrName: string | null;
  /** 选手 PB（undefined = 待拉取，行暂隐藏；null = 已拉取无成绩，显示 N/A） */
  pbA: SrPersonalBest | null | undefined;
  pbB: SrPersonalBest | null | undefined;
  /** 选手展示名（PB 行名称列） */
  nameA: string;
  nameB: string;
}>();

const wrText = computed(() => (props.wrSec == null ? null : formatRunTime(props.wrSec)));

interface PbRow {
  side: "A" | "B";
  text: string;
  name: string;
  /** 排序用成绩（秒）；null = 无成绩（N/A，沉底） */
  sec: number | null;
}
const pbRows = computed<PbRow[]>(() => {
  const mk = (side: "A" | "B", pb: SrPersonalBest | null | undefined): PbRow | null =>
    pb === undefined
      ? null
      : {
          side,
          text: formatRunTime(pb?.timeSec ?? null),
          name: side === "A" ? props.nameA : props.nameB,
          sec: pb?.timeSec ?? null,
        };
  return [mk("A", props.pbA), mk("B", props.pbB)]
    .filter((r): r is PbRow => r !== null)
    .sort((x, y) => (x.sec ?? Infinity) - (y.sec ?? Infinity));
});

/** 时间列定宽（注入 CSS 变量）：取可见行时间文本最长者——常规 MM:SS.mmm
 *  时列宽贴合文本，时间→名称间隔与标签→时间一致；出现小时位时整列同步
 *  加宽、名称仍对齐。每字符 +0.5px 补偿 letter-spacing 尾随宽度，使最长
 *  行不被撑出列外（否则其名称比其余行偏右）。 */
const timeCol = computed(() => {
  const texts = [wrText.value, ...pbRows.value.map((r) => r.text)].filter(
    (s): s is string => s !== null,
  );
  const n = Math.max(...texts.map((s) => s.length));
  return `calc(${n}ch + ${n * 0.5}px)`;
});
</script>

<template>
  <div class="pbcard neon-panel" :style="{ '--time-col': timeCol }">
    <div v-if="wrText" class="row wr">
      <span class="tag">WR</span>
      <span class="time">{{ wrText }}</span>
      <span v-if="wrName" class="name">{{ wrName }}</span>
    </div>
    <div v-for="r in pbRows" :key="r.side" class="row" :class="r.side === 'A' ? 'side-a' : 'side-b'">
      <span class="tag">PB</span>
      <span class="time">{{ r.text }}</span>
      <span class="name">{{ r.name }}</span>
    </div>
  </div>
</template>

<style scoped>
/* 霓虹 panel 同款但直角边（满贴边口径，对齐偏差条 / 选图卡）。场景页无全局
   border-box：width/height 100% 须显式声明，否则边框 + 内边距外溢出包裹层
   （右/底贴边锚定时即伸出画面外） */
.pbcard.neon-panel {
  box-sizing: border-box;
  border-radius: 0;
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 1.5cqh 2.6cqw;
}
/* 三行均分卡高：标签 → 时间 → 名称 顺排，元素间隔与卡片水平内边距
   （= 标签左边距）一致；名称占余宽、左对齐、过长省略号 */
.row {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  gap: 2.6cqw;
}
.row + .row {
  border-top: 1px solid rgba(120, 80, 200, 0.22);
}
.time {
  font-size: 19cqh;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.5px;
  font-family: "JetBrains Mono", ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, monospace;
  /* 定宽列：宽 = 可见行最长时间文本（脚本注入，含小时位自适应）+ 每 字符
     0.5px 的 letter-spacing 补偿——名称起点各行一致，最长行与名称的间隔
     恰为行 gap */
  flex: none;
  width: var(--time-col);
}
/* 标签（WR / PB）等宽字体 */
.tag {
  font-size: 14cqh;
  font-weight: 800;
  letter-spacing: 1px;
  font-family: "JetBrains Mono", ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, monospace;
}
/* 名称：随标签同比放大，占行内余宽 */
.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
  font-size: 14.5cqh;
  font-weight: 700;
}
/* 标签保留行色与辉光：WR 金 = 榜单榜首名次色；PB = 榜单选手高亮（同辉光） */
.row.wr .tag {
  color: var(--syn-win);
  text-shadow: 0 0 10px rgba(255, 209, 102, 0.5);
}
.row.side-a .tag {
  color: var(--syn-a);
  text-shadow: 0 0 9px rgba(61, 139, 255, 0.55);
}
.row.side-b .tag {
  color: var(--syn-b);
  text-shadow: 0 0 9px rgba(255, 107, 74, 0.55);
}
/* 时间与名称统一弱化色（榜单 4 名外名次色），无辉光 */
.time,
.name {
  color: var(--syn-text-dim);
}
</style>

<script setup lang="ts">
/**
 * 选手计时器：主计时器（大字，白色等宽）+ 主计时器正下方与文本等宽的选手色
 * 线条 + 副计时器两行。锚定：主计时贴外层计时区顶（= 偏差条下缘），两行副
 * 计时贴画面底，中间余量由 space-between 自然分布（主计时不缩号）。
 * 多关：上行 = 当前关卡名 + 实时单段时间（live_time segment 外推，白色），
 * 下行 = 上一关（最近完成）名 + 单段用时（淡紫 = PB 卡弱化色）；选手通过
 * 一关后上行内容沉入下行、上行换新关。单关：上行 = 「当前次数/总次数」+
 * 当前尝试实时分段时间（live_time segment），下行 = 同一进度 + 上一次尝试
 * 用时；两者都沿用同一两行副计时几何。两行标签盒外缘对齐线条外缘、盒宽
 * 占满「主计时器盒宽 − 该行计时」的余量，文本超余量时按比例缩小字号（下限
 * 后截断兜底）——几何由脚本量测钉死（fitLevel），量测手法与 MatchScene 角标
 * 卡锚定同源。
 * A 块整体靠右对齐、B 块靠左对齐——外层 .timers 双列以画面水平中心为锚。
 */
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

/**
 * 透明占位字符（不间断空格）：空 flex 项没有文本基线，浏览器按盒底缘合成
 * 基线，baseline 行会被撑高——关卡名出现 / 副计时出值瞬间主计时器与线条被
 * 顶起跳位。占位用 NBSP 保住真实基线，行高在空 / 有值各组合下恒定。
 */
const NBSP = "\u00A0";

const props = defineProps<{
  side: "A" | "B";
  /** 主计时器文本（已格式化） */
  main: string;
  /** 上行：选手当前所处关卡名（仅回合进行中且该选手仍在游戏内时由父级传入）；
   *  null = 隐藏 */
  level?: string | null;
  /** 上行：当前关实时单段时间（live_time segment 外推，已格式化）；null = 隐藏 */
  seg?: string | null;
  /** 下行：上一关（最近完成）关卡名；null = 隐藏 */
  prevLevel?: string | null;
  /** 下行：上一关单段用时（已格式化）；null = 隐藏 */
  prevSeg?: string | null;
}>();

// ---- 关卡名几何量测（.stack = 主计时器盒 = 线条宽，是全部宽度的锚） ----
const stackEl = ref<HTMLElement | null>(null);
const rowEl = ref<HTMLElement | null>(null);
const subEl = ref<HTMLElement | null>(null);
const levelEl = ref<HTMLElement | null>(null);
const prevSubEl = ref<HTMLElement | null>(null);
const prevLevelEl = ref<HTMLElement | null>(null);

/** 字号收缩下限（占基准字号比例），更长的名字按截断兜底 */
const MIN_FONT_SCALE = 0.55;

/**
 * 钉单个关卡名盒几何：盒宽 = 主计时器盒宽 − 同行计时盒宽 − 间隙（外缘恰好
 * 对齐线条外缘）；文本自然宽超出盒宽时按比例缩小字号（等宽文本宽随字号线性，
 * 一次缩放即贴合）。
 */
function fitLabel(level: HTMLElement, sub: HTMLElement): void {
  const stack = stackEl.value;
  const row = rowEl.value;
  if (!stack || !row) return;
  const gap = parseFloat(getComputedStyle(row).gap) || 0;
  const avail = Math.max(0, stack.offsetWidth - sub.offsetWidth - gap);
  // 先复位为自然宽量文本（右对齐的溢出不计入 scrollWidth，须 auto 实量）
  level.style.width = "auto";
  level.style.fontSize = "";
  const natural = level.offsetWidth;
  let font = "";
  if (natural > avail && natural > 0) {
    const base = parseFloat(getComputedStyle(level).fontSize);
    if (base > 0) {
      font = `${Math.max((base * avail) / natural, base * MIN_FONT_SCALE)}px`;
    }
  }
  level.style.width = `${avail}px`;
  level.style.fontSize = font;
}

/**
 * 钉两行关卡名几何（各行独立量测收缩）。视口缩放 / 字体加载都会改变锚宽，
 * 由 RO + resize + fonts.ready 复测；本组件自身写入不回馈锚元素尺寸，无循环触发。
 */
function fitLevel(): void {
  if (levelEl.value && subEl.value) fitLabel(levelEl.value, subEl.value);
  if (prevLevelEl.value && prevSubEl.value) fitLabel(prevLevelEl.value, prevSubEl.value);
}

let ro: ResizeObserver | null = null;

onMounted(() => {
  fitLevel();
  ro = new ResizeObserver(fitLevel);
  if (stackEl.value) ro.observe(stackEl.value);
  if (subEl.value) ro.observe(subEl.value);
  if (prevSubEl.value) ro.observe(prevSubEl.value);
  window.addEventListener("resize", fitLevel);
  // webfont 迟到会改变 ch 实宽（stack/sub 锚宽随之变，RO 兜得住；此处补一次）
  document.fonts.ready.then(fitLevel).catch(() => {});
});

onBeforeUnmount(() => {
  ro?.disconnect();
  window.removeEventListener("resize", fitLevel);
});

// 关卡名变化：DOM 文本更新后再量（post），否则量到旧文本
watch(
  () => [props.level, props.prevLevel],
  () => fitLevel(),
  { flush: "post" },
);
</script>

<template>
  <div class="timer" :class="side">
    <!-- 宽度收缩为主文本宽，使线条与主计时器文本等宽 -->
    <div ref="stackEl" class="stack">
      <div class="main">{{ main }}</div>
      <div class="rule" />
    </div>
    <!-- 副计时器两行：多关上行 = 当前关卡名 + 实时单段（白），下行 = 上一关 +
         单段用时（淡紫，PB 卡弱化色）；单关两行标签均为「当前次数/总次数」，
         上行 = 当前尝试实时单段，下行 = 上一次尝试用时。任一元素缺省降为透明
         占位（NBSP 保基线 + 满量程宽，行高恒定，主计时器与另一行位置不偏移） -->
    <div class="subs">
      <div ref="rowEl" class="sub-row">
        <div ref="levelEl" class="level" :class="{ ghost: !level }">{{ level ?? NBSP }}</div>
        <div ref="subEl" class="sub" :class="{ ghost: seg == null }">{{ seg ?? NBSP }}</div>
      </div>
      <div class="sub-row prev">
        <div
          ref="prevLevelEl"
          class="level"
          :class="{ ghost: !prevLevel }"
        >{{ prevLevel ?? NBSP }}</div>
        <div
          ref="prevSubEl"
          class="sub"
          :class="{ ghost: prevSeg == null }"
        >{{ prevSeg ?? NBSP }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.timer {
  display: flex;
  flex-direction: column;
  /* 满高撑开（外层 .timers 行拉伸）：主计时贴区顶（= 偏差条下缘），两行
     副计时贴区底（= 画面底），中间余量自然分布——锚定关系由此钉死 */
  justify-content: space-between;
  font-family: "JetBrains Mono Variable", ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, monospace;
}
/* A 靠右、B 靠左，对齐画面水平中心 */
.timer.A {
  align-items: flex-end;
}
.timer.B {
  align-items: flex-start;
}
.stack {
  display: flex;
  flex-direction: column;
  gap: 0.5vh;
  width: fit-content;
}
.main {
  /* 主计时保持原 6vh 大字：两行副计时的纵向空间由外层 .timers 区加高让出
     （17.4vh），主计时不再为容纳副计时缩号 */
  font-size: clamp(30px, 6vh, 66px);
  font-weight: 700;
  line-height: 1.1;
  color: #fff;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.7);
  /* 满量程等宽占位（MM:SS.mmm = 9 字符，等宽字体 9ch 即满宽）：单关未出
     成绩显示 N/A 等短文本时盒宽不缩——下划线与选图卡锚点不跳 */
  min-width: 9ch;
}
/* 短文本在占位盒内仍收右缘（数字自右缘向左生长，与满量程时的位序一致） */
.timer.A .main {
  text-align: right;
}
/* 与主计时器文本等宽的选手色线条 */
.rule {
  height: 0.45vh;
  min-height: 3px;
  border-radius: 2px;
}
.timer.A .rule {
  background: var(--syn-a);
  box-shadow: 0 0 10px rgba(61, 139, 255, 0.55);
}
.timer.B .rule {
  background: var(--syn-b);
  box-shadow: 0 0 10px rgba(255, 107, 74, 0.55);
}
/* 副计时器两行容器 */
.subs {
  display: flex;
  flex-direction: column;
  gap: 0.5vh;
}
/* 副计时器行：小字计时 + 关卡名标签（默认 A 布局——标签在外侧左） */
.sub-row {
  display: flex;
  align-items: baseline;
  gap: 1vh;
}
/* B 侧镜像：标签移到外侧右 */
.timer.B .sub-row {
  flex-direction: row-reverse;
}
/* 下行（上一关）：淡紫弱化色（同 PB 卡时间 / 名称列），无辉光 */
.sub-row.prev .level,
.sub-row.prev .sub {
  color: var(--syn-text-dim);
  text-shadow: none;
}
/* 关卡名：小号标签。盒宽与字号由脚本 fitLevel 钉死（外缘对齐线条外缘、
   超余量缩字号），flex 不再伸缩；短名贴外缘、超限截断吃内侧余量 */
.level {
  flex: none;
  font-size: clamp(12px, 2.3vh, 26px);
  font-weight: 800;
  color: #fff;
  line-height: 1.1;
  min-height: 1.1em; /* 空内容时保留行高占位 */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.7);
  transition: opacity 0.3s ease;
}
.timer.A .level {
  text-align: left;
}
.timer.B .level {
  text-align: right;
}
.level.ghost {
  opacity: 0;
}
.sub {
  flex: none;
  font-size: clamp(14px, 2.8vh, 30px);
  font-weight: 700;
  color: #fff;
  line-height: 1.1;
  min-height: 1.1em; /* 空内容时保留行高占位 */
  /* 隐藏时也按满量程（MM:SS.mmm = 9 字符）占宽：关卡名盒宽由它推导，
     首条成绩出现时标签不横向跳动（同 .main 的 min-width 手法） */
  min-width: 9ch;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.7);
  transition: opacity 0.3s ease;
}
.sub.ghost {
  opacity: 0;
}
</style>

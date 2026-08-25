<script setup lang="ts">
/**
 * 选手计时器：主计时器（大字，白色等宽）+ 主计时器正下方与文本等宽的选手色
 * 线条 + 副计时器（小字，单关模式不渲染）。
 * 多关：主 = 通过上一关卡时的累计总耗时，副 = 上一关卡的单段耗时；
 * 单关：主 = 后端成绩（最快 / 平均尝试），副隐藏。
 * A 块整体靠右对齐、B 块靠左对齐——外层 .timers 双列以画面水平中心为锚。
 */
defineProps<{
  side: "A" | "B";
  /** 主计时器文本（已格式化） */
  main: string;
  /** 副计时器文本（已格式化）；null = 隐藏 */
  sub?: string | null;
}>();
</script>

<template>
  <div class="timer" :class="side">
    <!-- 宽度收缩为主文本宽，使线条与主计时器文本等宽 -->
    <div class="stack">
      <div class="main">{{ main }}</div>
      <div class="rule" />
    </div>
    <!-- 副计时器隐藏时降为透明占位（保留行高，避免主计时器位置偏移） -->
    <div class="sub" :class="{ ghost: sub == null }">{{ sub }}</div>
  </div>
</template>

<style scoped>
.timer {
  display: flex;
  flex-direction: column;
  gap: 0.6vh;
  font-family: "JetBrains Mono", ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, monospace;
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
.sub {
  font-size: clamp(14px, 2.8vh, 30px);
  font-weight: 700;
  color: #fff;
  line-height: 1.1;
  min-height: 1.1em; /* 空内容时保留行高占位 */
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.7);
  transition: opacity 0.3s ease;
}
.sub.ghost {
  opacity: 0;
}
</style>

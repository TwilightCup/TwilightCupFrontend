<script setup lang="ts">
/**
 * 选手计时器：主计时器（大字）+ 副计时器（小字，位于主计时器下方）。
 * 多关：主 = 通过上一关卡时的累计总耗时，副 = 上一关卡的单段耗时；
 * 单关：主 = 后端成绩（最快 / 平均尝试），副隐藏。
 * side='A' 蓝（左）、'B' 红（右）。
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
    <div class="main">{{ main }}</div>
    <div v-if="sub != null" class="sub">{{ sub }}</div>
  </div>
</template>

<style scoped>
.timer {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.3vh;
}
.main {
  font-size: clamp(30px, 6vh, 66px);
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  letter-spacing: 1px;
  line-height: 1.1;
}
.timer.A .main {
  color: var(--syn-a);
  text-shadow: 0 0 18px rgba(61, 139, 255, 0.45), 0 2px 10px rgba(0, 0, 0, 0.7);
}
.timer.B .main {
  color: var(--syn-b);
  text-shadow: 0 0 18px rgba(255, 107, 74, 0.45), 0 2px 10px rgba(0, 0, 0, 0.7);
}
.sub {
  font-size: clamp(14px, 2.8vh, 30px);
  font-weight: 700;
  color: var(--syn-text);
  opacity: 0.85;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}
</style>

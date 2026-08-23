<script setup lang="ts">
/**
 * 多关偏差条：以游标为界，左侧填 A 主题色、右侧填 B 主题色；白色竖向短线游标
 * + 游标正下方（条外）跟随移动的偏差值（纯白，计时格式绝对值，如 +00:02.45）。
 *
 * diffMs 有符号：正 = B 落后（游标向 B/右侧），负 = A 落后（向左侧）。
 * 游标随偏差线性移动，|diff| = gapMs（默认 60s）时触边钉住；偏差值无上限继续增长。
 */
import { computed } from "vue";

const props = defineProps<{
  /** 有符号偏差（毫秒）：正 = B 落后，负 = A 落后 */
  diffMs: number;
  /** 满偏对应的偏差绝对值（毫秒） */
  gapMs: number;
}>();

/** 游标偏移百分比：±50 = 触边 */
const offsetPct = computed(() => {
  const ratio = Math.max(-1, Math.min(1, props.diffMs / props.gapMs));
  return ratio * 50;
});

/** 偏差值文本：绝对值 + 前缀，MM:SS.cc（厘秒） */
const diffText = computed(() => {
  const cs = Math.max(0, Math.round(Math.abs(props.diffMs) / 10));
  const m = Math.floor(cs / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `+${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
});
</script>

<template>
  <div class="diff">
    <div class="track">
      <div class="fill a" :style="{ width: `calc(50% + ${offsetPct}%)` }" />
      <div class="fill b" :style="{ width: `calc(50% - ${offsetPct}%)` }" />
    </div>
    <div class="cursor" :style="{ left: `calc(50% + ${offsetPct}%)` }" />
    <div class="value" :style="{ left: `calc(50% + ${offsetPct}%)` }">{{ diffText }}</div>
  </div>
</template>

<style scoped>
.diff {
  position: relative;
  width: 100%;
}
.track {
  position: relative;
  height: 3vh;
  min-height: 22px;
  border-radius: 999px;
  overflow: hidden;
  border: 1px solid var(--syn-border);
  background: rgba(8, 0, 20, 0.7);
  box-shadow: inset 0 0 12px rgba(0, 0, 0, 0.5);
}
/* 游标为界：左 A 右 B（越向落后方移动，领先方的领地越大） */
.fill {
  position: absolute;
  top: 0;
  bottom: 0;
  transition: width 0.3s linear;
}
.fill.a {
  left: 0;
  border-radius: 999px 0 0 999px;
  background: linear-gradient(90deg, rgba(61, 139, 255, 0.25), var(--syn-a));
}
.fill.b {
  right: 0;
  border-radius: 0 999px 999px 0;
  background: linear-gradient(270deg, rgba(255, 107, 74, 0.25), var(--syn-b));
}
/* 白色游标：略高出条体的竖向短线 */
.cursor {
  position: absolute;
  top: -0.7vh;
  height: calc(3vh + 1.4vh);
  min-height: 28px;
  width: 5px;
  background: #fff;
  border-radius: 3px;
  transform: translateX(-50%);
  box-shadow: 0 0 10px 2px rgba(255, 255, 255, 0.8);
  transition: left 0.3s linear;
  z-index: 1;
}
/* 偏差值：游标正下方、条体外部，随游标同步移动 */
.value {
  position: absolute;
  top: calc(3vh + 1vh);
  transform: translateX(-50%);
  font-size: clamp(16px, 2.6vh, 30px);
  font-weight: 800;
  color: #fff;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.85);
  transition: left 0.3s linear;
}
</style>

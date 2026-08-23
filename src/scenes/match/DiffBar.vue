<script setup lang="ts">
/**
 * 多关偏差条：以游标为界，左侧填 A 主题色、右侧填 B 主题色；白色竖向游标
 * （直角、不出条体）+ 游标正下方（条外）跟随移动的偏差值（纯白绝对值，
 * 不足 1 分钟显示 SS.cc，达到 1 分钟后显示 MM:SS.cc）。
 *
 * 条体直角无描边、满宽，上缘由外层贴紧选手画面下缘。偏差值随游标移动，
 * 但水平位置经 clamp 限制在画面内（触边时向内收，不再溢出屏幕）。
 *
 * diffMs 有符号：正 = B 落后（游标向 B/右侧），负 = A 落后（向左侧）。
 * 游标随偏差线性移动，|diff| = gapMs（默认 60s）时触边钉住；偏差值无上限继续增长。
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

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

/** 偏差值文本：绝对值，SS.cc；≥1 分钟进位为 MM:SS.cc（厘秒） */
const diffText = computed(() => {
  const cs = Math.max(0, Math.round(Math.abs(props.diffMs) / 10));
  const m = Math.floor(cs / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  const tail = `${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
  return m > 0 ? `${String(m).padStart(2, "0")}:${tail}` : tail;
});

// ---- 偏差值水平限位：量取自身半宽，clamp 在 [半宽, 100%−半宽] 内 ----
const valueEl = ref<HTMLElement | null>(null);
const valueHalfW = ref(0);
let ro: ResizeObserver | null = null;
onMounted(() => {
  ro = new ResizeObserver(() => {
    if (valueEl.value) valueHalfW.value = valueEl.value.offsetWidth / 2;
  });
  if (valueEl.value) ro.observe(valueEl.value);
});
onBeforeUnmount(() => ro?.disconnect());

const valueLeft = computed(
  () =>
    `clamp(${valueHalfW.value}px, calc(50% + ${offsetPct.value}%), calc(100% - ${valueHalfW.value}px))`,
);
</script>

<template>
  <div class="diff">
    <!-- track overflow:hidden 掩盖游标辉光超出条体的部分 -->
    <div class="track">
      <div class="fill a" :style="{ width: `calc(50% + ${offsetPct}%)` }" />
      <div class="fill b" :style="{ width: `calc(50% - ${offsetPct}%)` }" />
      <div class="cursor" :style="{ left: `calc(50% + ${offsetPct}%)` }" />
    </div>
    <div ref="valueEl" class="value" :style="{ left: valueLeft }">{{ diffText }}</div>
  </div>
</template>

<style scoped>
.diff {
  position: relative;
  width: 100%;
}
.track {
  position: relative;
  height: 1.2vh;
  min-height: 10px;
  overflow: hidden; /* 游标辉光限制在条体内 */
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
  background: var(--syn-a);
}
.fill.b {
  right: 0;
  background: var(--syn-b);
}
/* 白色游标：直角、与条体等高；置于 track 内，辉光经 overflow:hidden 只在条内显示 */
.cursor {
  position: absolute;
  top: 0;
  height: 100%;
  width: 5px;
  background: #fff;
  transform: translateX(-50%);
  box-shadow: 0 0 10px 2px rgba(255, 255, 255, 0.8);
  transition: left 0.3s linear;
  z-index: 1;
}
/* 偏差值：顶部贴紧游标底部（仅留小空隙），随游标同步移动（水平 clamp 在画面内） */
.value {
  position: absolute;
  top: calc(1.2vh + 0.2vh);
  transform: translateX(-50%);
  font-size: clamp(16px, 2.6vh, 30px);
  font-weight: 800;
  color: #fff;
  /* 数字等宽，避免跳动刷新时文本抖动 */
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.85);
  transition: left 0.3s linear;
}
</style>

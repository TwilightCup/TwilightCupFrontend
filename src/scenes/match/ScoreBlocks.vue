<script setup lang="ts">
/**
 * BO 胜点方块：渲染 threshold 个方块，前 wins 个点亮（方色+辉光），余暗。
 * 方块数 = 该场胜点数（如 BO9 → threshold 5）。side='A' 蓝、'B' 红。
 */
import { computed } from "vue";

const props = defineProps<{
  wins: number;
  threshold: number;
  side: "A" | "B";
}>();

const blocks = computed(() => {
  const n = Math.max(0, props.threshold);
  return Array.from({ length: n }, (_, i) => i < props.wins);
});
</script>

<template>
  <div class="blocks" :class="side">
    <span
      v-for="(lit, i) in blocks"
      :key="i"
      class="blk"
      :class="{ lit }"
    />
  </div>
</template>

<style scoped>
.blocks {
  display: inline-flex;
  gap: 5px;
}
.blk {
  width: clamp(14px, 1.6vw, 24px);
  height: clamp(14px, 1.6vw, 24px);
  border-radius: 4px;
  border: 1.5px solid rgba(255, 255, 255, 0.25);
  background: rgba(255, 255, 255, 0.06);
  transition: all 0.3s;
}
.blocks.A .blk.lit {
  background: var(--syn-a);
  border-color: var(--syn-a);
  box-shadow: 0 0 10px var(--syn-a), 0 0 18px rgba(61, 139, 255, 0.6);
}
.blocks.B .blk.lit {
  background: var(--syn-b);
  border-color: var(--syn-b);
  box-shadow: 0 0 10px var(--syn-b), 0 0 18px rgba(255, 107, 74, 0.6);
}
</style>

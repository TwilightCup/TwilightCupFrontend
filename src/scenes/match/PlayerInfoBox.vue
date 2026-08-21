<script setup lang="ts">
/**
 * 选手信息框：直播框下的历史速通战绩（多行）+ PB（单行）。
 * 内容由导播在配置面板填写（useDirectorConfig），暂不在后端持久化。
 * side='A' 蓝（左）、'B' 红（右）。
 */
import { bi } from "@/utils/bilingual";

defineProps<{
  side: "A" | "B";
  name: string;
  pb: string;
  history: string;
}>();
</script>

<template>
  <div class="info neon-panel" :class="side">
    <div class="head">
      <span class="nm" :class="side">{{ name }}</span>
      <span class="pb">
        <span class="pb-label">{{ bi("scenes.match.pb") }}</span>
        <span class="pb-val">{{ pb || "—" }}</span>
      </span>
    </div>
    <div class="hist">{{ history || bi("scenes.match.history") }}</div>
  </div>
</template>

<style scoped>
.info {
  width: 100%;
  padding: 10px 14px;
  border-radius: 12px;
  min-height: 80px;
}
.info.A {
  border-left: 4px solid var(--syn-a);
}
.info.B {
  border-left: 4px solid var(--syn-b);
}
.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
}
.nm {
  font-size: clamp(15px, 1.6vw, 22px);
  font-weight: 800;
  text-shadow: 0 1px 6px rgba(0, 0, 0, 0.6);
}
.nm.A {
  color: var(--syn-a);
}
.nm.B {
  color: var(--syn-b);
}
.pb {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.pb-label {
  font-size: 11px;
  color: var(--syn-text-dim);
  letter-spacing: 0.5px;
}
.pb-val {
  font-size: clamp(14px, 1.4vw, 20px);
  font-weight: 800;
  color: var(--syn-win);
  text-shadow: 0 0 8px rgba(255, 209, 102, 0.5);
}
.hist {
  font-size: clamp(11px, 1.1vw, 15px);
  line-height: 1.5;
  color: var(--syn-text);
  white-space: pre-wrap;
}
</style>

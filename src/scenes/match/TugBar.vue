<script setup lang="ts">
/**
 * 双向计时差进度条（拔河条）。
 *
 * "最后一个相同的有计时回报的项目" = 双方都完成的最高 level_index。取该关卡累计用时
 * （优先 total_ms，否则 time_ms），算 A/B 差值，映射为指针偏移。
 *
 * 布局：左 = A(蓝)，右 = B(红)（与全局 A/B 色一致）。指针默认居中；
 * 慢方把指针推向对侧（拔河语义）：A 慢 → diff>0 → 指针偏右（倒向红/B）。
 * gapMs 为满偏对应的差值（默认 60s）。
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { PlayerStatus, type LevelTime } from "@/api/types";
import { formatMs } from "@/utils/format";

const props = defineProps<{
  levelsA: LevelTime[];
  levelsB: LevelTime[];
  statusA: PlayerStatus;
  statusB: PlayerStatus;
  gapMs: number;
}>();

const { t } = useI18n();

/** 双方都完成的最高 level_index */
function maxIdx(levels: LevelTime[]): number {
  return levels.reduce((m, l) => Math.max(m, l.level_index), -1);
}
/** 某关卡的用时（优先 total_ms） */
function timeAt(levels: LevelTime[], idx: number): number | null {
  const hit = levels.find((l) => l.level_index === idx);
  if (!hit) return null;
  return hit.total_ms ?? hit.time_ms ?? null;
}

const common = computed(() => {
  const c = Math.min(maxIdx(props.levelsA), maxIdx(props.levelsB));
  if (c < 0) return null;
  const tA = timeAt(props.levelsA, c);
  const tB = timeAt(props.levelsB, c);
  if (tA == null || tB == null) return null;
  return { idx: c, tA, tB };
});

const offsetPct = computed<number>(() => {
  // 弃权：钉到对侧极限
  if (props.statusA === PlayerStatus.FORFEITED) return 50; // A 弃 → 倒向 B(右)
  if (props.statusB === PlayerStatus.FORFEITED) return -50; // B 弃 → 倒向 A(左)
  const c = common.value;
  if (!c) return 0;
  const diff = c.tA - c.tB; // +: A 慢；-: B 慢
  const ratio = Math.max(-1, Math.min(1, diff / props.gapMs));
  return ratio * 50; // +50 = 远右(B)，-50 = 远左(A)
});

const tA = computed(() => (common.value ? formatMs(common.value.tA) : "—"));
const tB = computed(() => (common.value ? formatMs(common.value.tB) : "—"));
const forfeited = computed(
  () => props.statusA === PlayerStatus.FORFEITED || props.statusB === PlayerStatus.FORFEITED,
);
</script>

<template>
  <div class="tug">
    <div class="track">
      <div class="half left" />
      <div class="half right" />
      <div class="center-tick" />
      <div
        class="needle"
        :style="{ left: `calc(50% + ${offsetPct}%)` }"
      />
    </div>
    <div class="labels">
      <span class="lab a">{{ tA }}</span>
      <span v-if="forfeited" class="fo">{{ t("scenes.match.forfeit") }}</span>
      <span class="lab b">{{ tB }}</span>
    </div>
  </div>
</template>

<style scoped>
.tug {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.track {
  position: relative;
  height: 3.2vh;
  min-height: 26px;
  border-radius: 999px;
  overflow: hidden;
  border: 1px solid var(--syn-border);
  box-shadow: inset 0 0 12px rgba(0, 0, 0, 0.5);
}
.half {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 50%;
}
.half.left {
  left: 0;
  background: linear-gradient(90deg, var(--syn-a), rgba(61, 139, 255, 0.25));
}
.half.right {
  right: 0;
  background: linear-gradient(270deg, var(--syn-b), rgba(255, 107, 74, 0.25));
}
.center-tick {
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 2px;
  background: rgba(255, 255, 255, 0.6);
  transform: translateX(-50%);
}
.needle {
  position: absolute;
  top: -20%;
  bottom: -20%;
  width: 6px;
  background: #fff;
  border-radius: 3px;
  transform: translateX(-50%);
  box-shadow: 0 0 12px 3px rgba(255, 255, 255, 0.85);
  transition: left 0.4s ease;
}
.labels {
  display: flex;
  justify-content: space-between;
  font-size: clamp(12px, 1.2vw, 18px);
  font-weight: 700;
}
.lab.a {
  color: var(--syn-a);
}
.lab.b {
  color: var(--syn-b);
}
.fo {
  color: var(--syn-win);
  font-weight: 800;
}
</style>

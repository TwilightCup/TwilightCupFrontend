<script setup lang="ts">
/**
 * 赛程图单个对阵卡：A(蓝,左) vs B(红,右) + 比分 + 胜方高亮 + 状态。
 *
 * is_bye → "BYE"；status RUNNING → 脉动；胜方名字描金。比分缺省显示 "—"
 * （fixtureId 无对应 score，如未开始 / 比分拉取失败）。
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { FixtureStatus, type FixtureOut } from "@/api/types";

const props = defineProps<{
  fixture: FixtureOut;
  /** fixtureId → {a,b}（来自 useBracketData.scores） */
  score?: { a: number | null; b: number | null } | null;
  /** accountId → 展示名 */
  nameOf: (id: string | null) => string;
  /** 该对阵是否处于当前轮（高亮整张卡） */
  isCurrent: boolean;
}>();

const { t } = useI18n();

const isRunning = computed(() => props.fixture.status === FixtureStatus.RUNNING);
const winnerIsA = computed(
  () => !!props.fixture.winner_id && props.fixture.winner_id === props.fixture.player_a_id,
);
const winnerIsB = computed(
  () => !!props.fixture.winner_id && props.fixture.winner_id === props.fixture.player_b_id,
);

const scoreA = computed(() => props.score?.a ?? null);
const scoreB = computed(() => props.score?.b ?? null);
const hasScore = computed(
  () => scoreA.value !== null || scoreB.value !== null,
);
</script>

<template>
  <div class="card neon-panel" :class="{ current: isCurrent, running: isRunning }">
    <!-- A（蓝，上） -->
    <div class="side" :class="{ win: winnerIsA, bye: fixture.is_bye }">
      <span class="nm">{{ fixture.is_bye ? t('scenes.bracket.bye') : nameOf(fixture.player_a_id) }}</span>
      <span class="sc">{{ hasScore ? scoreA : '—' }}</span>
    </div>
    <div class="divider" />
    <!-- B（红，下） -->
    <div class="side b" :class="{ win: winnerIsB }">
      <span class="nm">{{ nameOf(fixture.player_b_id) }}</span>
      <span class="sc">{{ hasScore ? scoreB : '—' }}</span>
    </div>
    <span v-if="isCurrent" class="cur-tag">{{ t('scenes.bracket.currentRound') }}</span>
  </div>
</template>

<style scoped>
.card {
  position: relative;
  width: 200px;
  padding: 6px 0;
  border-radius: 10px;
  transition: box-shadow 0.3s, border-color 0.3s;
}
.card.running {
  border-color: var(--syn-cyan);
  box-shadow: 0 0 16px rgba(34, 227, 255, 0.4);
  animation: pulse 1.6s ease-in-out infinite;
}
.card.current {
  border-color: var(--syn-win);
  box-shadow: 0 0 18px rgba(255, 209, 102, 0.45);
}
@keyframes pulse {
  0%, 100% { box-shadow: 0 0 12px rgba(34, 227, 255, 0.25); }
  50% { box-shadow: 0 0 22px rgba(34, 227, 255, 0.55); }
}
.side {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 12px;
  font-size: 14px;
}
.side.b .nm {
  color: var(--syn-b);
}
.side:not(.b) .nm {
  color: var(--syn-a);
}
.nm {
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 130px;
}
.sc {
  font-weight: 900;
  font-size: 16px;
  color: var(--syn-text);
  min-width: 1.2em;
  text-align: right;
}
.side.win .nm {
  color: var(--syn-win) !important;
  text-shadow: 0 0 8px rgba(255, 209, 102, 0.6);
}
.side.win .sc {
  color: var(--syn-win);
}
.divider {
  height: 1px;
  margin: 0 10px;
  background: var(--syn-border);
}
.cur-tag {
  position: absolute;
  top: -9px;
  left: 50%;
  transform: translateX(-50%);
  padding: 1px 8px;
  border-radius: 999px;
  background: var(--syn-win);
  color: #2a1a00;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.5px;
  white-space: nowrap;
}
</style>

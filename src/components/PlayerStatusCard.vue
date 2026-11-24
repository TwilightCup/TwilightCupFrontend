<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useMatchStore } from "@/stores/match";
import {
  attemptStatusLabel,
  attemptVisible,
  formatMs,
  formatUtcTime,
  invalidReasonsTitle,
  playerStatusInfo,
  seatLabel,
} from "@/utils/format";
import { MatchPhase, AttemptStatus } from "@/api/types";

const props = defineProps<{ side: "A" | "B" }>();

const { t } = useI18n();
const match = useMatchStore();

const player = computed(() => match.players[props.side]);
const ready = computed(() => (props.side === "A" ? match.aReady : match.bReady));
/** 离线优先展示：回合内状态（完成/弃权）仍有意义，但「游戏中」在离线时误导 */
const statusInfo = computed(() =>
  player.value.online
    ? playerStatusInfo(player.value.status)
    : { label: t("playerStatus.offline"), type: "info" as const },
);
const showReady = computed(() => match.phase === MatchPhase.PREP);

const isMulti = computed(() => player.value.completedLevels.length > 0);
/** 单关明细：含已跳过（N/A）的尝试，未开始的（UNFINISHED 占位）不显示 */
const visibleAttempts = computed(() =>
  player.value.attempts.filter((a) => attemptVisible(a.status)),
);
const isSingle = computed(
  () => !isMulti.value && visibleAttempts.value.length > 0,
);
const liveScore = computed(() => match.liveScore[props.side]);
const utc = computed(() => (props.side === "A" ? match.utcA : match.utcB));

const levels = computed(() =>
  [...player.value.completedLevels].sort((a, b) => a.level_index - b.level_index),
);
const attempts = computed(() =>
  [...visibleAttempts.value].sort((a, b) => a.index - b.index),
);
const attemptSkipped = (a: { status: number }): boolean =>
  a.status === AttemptStatus.SKIPPED;
/** INVALID：整行删除线+红色，时长保留展示（证据），原因放 tooltip */
const attemptInvalid = (a: { status: number }): boolean =>
  a.status === AttemptStatus.INVALID;
</script>

<template>
  <div class="card" :class="side.toLowerCase()">
    <div class="head">
      <div class="who">
        <span class="seat">{{ match.playerNames[side] || seatLabel(side) }}</span>
        <span class="presence" :class="{ off: !player.online }" :title="player.online ? '' : t('playerStatus.offline')"></span>
      </div>
      <div class="tags">
        <el-tag
          v-if="showReady"
          :type="ready ? ('success' as const) : ('info' as const)"
          size="small"
          effect="dark"
        >
          {{ ready ? $t('playerStatus.ready') : $t('playerStatus.notReady') }}
        </el-tag>
        <el-tag :type="statusInfo.type" size="small" effect="dark">
          {{ statusInfo.label }}
        </el-tag>
      </div>
    </div>

    <div v-if="utc" class="utc">
      <span class="utc-label">{{ $t('playerStatusCard.utcSync') }}</span>
      <span class="utc-time">{{ formatUtcTime(utc.utcMs) }}</span>
    </div>

    <div class="score">
      <div class="score-num">{{ formatMs(liveScore) }}</div>
      <div class="score-label">{{ $t('playerStatusCard.currentScore') }}</div>
    </div>

    <div v-if="player.forfeited" class="forfeit">{{ $t('playerStatus.forfeited') }}</div>

    <div class="detail">
      <div v-if="isMulti" class="levels">
        <div class="sub">{{ $t('playerStatusCard.multiDetail') }}</div>
        <div v-for="lv in levels" :key="lv.level_index" class="row">
          <span class="idx">{{ $t('playerStatusCard.levelIndex', { n: lv.level_index + 1 }) }}</span>
          <span class="t">{{ formatMs(lv.time_ms) }}</span>
          <span class="total">{{ $t('playerStatusCard.cumulative', { time: formatMs(lv.total_ms) }) }}</span>
        </div>
      </div>
      <div v-else-if="isSingle" class="attempts">
        <div class="sub">{{ $t('playerStatusCard.singleAttempt') }}</div>
        <div
          v-for="a in attempts"
          :key="a.index"
          class="row"
          :class="{ na: attemptSkipped(a), invalid: attemptInvalid(a) }"
          :title="attemptInvalid(a) ? invalidReasonsTitle(a.invalid_reasons) : ''"
        >
          <span class="idx">{{ $t('playerStatusCard.attemptIndex', { n: a.index + 1 }) }}</span>
          <span class="t">{{ formatMs(a.time_ms) }}</span>
          <span class="status">{{ attemptStatusLabel(a.status) }}</span>
        </div>
      </div>
      <div v-else class="empty">{{ $t('playerStatusCard.waiting') }}</div>
    </div>
  </div>
</template>

<style scoped>
.card {
  background: var(--tc-bg-soft);
  border: 1px solid var(--tc-border);
  border-radius: 12px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  position: relative;
  overflow: hidden;
}
.card.a {
  border-top: 3px solid var(--tc-a);
}
.card.b {
  border-top: 3px solid var(--tc-b);
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.who {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.seat {
  font-size: 16px;
  font-weight: 700;
}
/* 在线状态指示点 */
.presence {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #37d27a;
  flex-shrink: 0;
}
.presence.off {
  background: #7a7f8a;
}
.card.a .seat {
  color: var(--tc-a);
}
.card.b .seat {
  color: var(--tc-b);
}
.tags {
  display: flex;
  gap: 6px;
}
.utc {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--tc-text-dim);
  border-top: 1px dashed var(--tc-border);
  padding-top: 6px;
}
.utc-time {
  font-weight: 600;
  color: var(--tc-text);
  font-variant-numeric: tabular-nums;
}
.score {
  text-align: center;
  padding: 6px 0;
}
.score-num {
  font-size: 34px;
  font-weight: 800;
  line-height: 1;
}
.score-label {
  font-size: 12px;
  color: var(--tc-text-dim);
}
.forfeit {
  text-align: center;
  color: #ff7a7a;
  font-weight: 700;
  letter-spacing: 2px;
  padding: 4px;
  background: #2a1414;
  border-radius: 6px;
}
.detail {
  border-top: 1px dashed var(--tc-border);
  padding-top: 8px;
  min-height: 40px;
}
.sub {
  font-size: 12px;
  color: var(--tc-text-dim);
  margin-bottom: 4px;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  padding: 2px 0;
}
.idx {
  color: var(--tc-text-dim);
  width: 80px;
}
.t {
  font-weight: 600;
}
.total,
.status {
  color: var(--tc-text-dim);
  font-size: 12px;
}
/* 跳过（N/A）的尝试整行弱化 */
.row.na .t {
  color: var(--tc-text-dim);
  font-weight: 400;
}
/* 无效尝试：删除线 + 红色（时长保留作证据，不计分） */
.row.invalid .t,
.row.invalid .status {
  color: #ff7a7a;
  text-decoration: line-through;
}
.empty {
  color: var(--tc-text-dim);
  font-size: 13px;
  text-align: center;
  padding: 8px 0;
}
</style>

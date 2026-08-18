<script setup lang="ts">
import { computed } from "vue";
import { ElMessageBox } from "element-plus";
import { useI18n } from "vue-i18n";
import { useMatchStore } from "@/stores/match";
import { useDraftStore, type Side } from "@/stores/draft";
import {
  RoundVerdict,
  PickType,
  AttemptStatus,
  type RoundRecord,
  type RoundVerdict as RV,
} from "@/api/types";
import {
  attemptStatusLabel,
  formatMs,
  invalidReasonsTitle,
  pickTypeLabel,
  roundSourceLabel,
  verdictInfo,
} from "@/utils/format";

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ (e: "update:modelValue", v: boolean): void }>();

const { t } = useI18n();
const match = useMatchStore();
const draft = useDraftStore();

const sortedRounds = computed(() =>
  [...match.roundsCache].sort((a, b) => b.round_no - a.round_no),
);

/**
 * 本场 ban/pick/protect 摘要（来自裁判端 draft store，纯前端状态）。
 * ban/protect 整场一次，CT 词条禁用整场一次；按图池 codeLabel 展示成 chip。
 */
interface DraftChip {
  code: string;
  label: string;
  kind: "ban" | "protect" | "tagban";
  by: Side;
}
const draftSummary = computed<{ bans: DraftChip[]; protects: DraftChip[]; tagBans: { tag: string; by: Side }[] }>(() => {
  const bans: DraftChip[] = [];
  const protects: DraftChip[] = [];
  for (const a of draft.state.actions) {
    const chip: DraftChip = { code: a.code, label: draft.codeLabel(a.code), kind: a.kind, by: a.by };
    if (a.kind === "ban") bans.push(chip);
    else protects.push(chip);
  }
  const tagBans: { tag: string; by: Side }[] = [];
  (["A", "B"] as Side[]).forEach((side) => {
    const tag = draft.state.tagBanBy[side];
    if (tag) tagBans.push({ tag, by: side });
  });
  return { bans, protects, tagBans };
});

/** 本回合的选图是哪一方 pick 的（跨回合累积列表里找 code）。 */
function pickerOf(code: string): Side | null {
  const p = draft.state.picks.find((pk) => pk.code === code);
  return p ? p.by : null;
}

const verdictOptions: { value: RV; label: string }[] = (
  [
    RoundVerdict.A_WIN,
    RoundVerdict.B_WIN,
    RoundVerdict.TIE_REMATCH,
    RoundVerdict.A_DISCONNECT_LOSS,
    RoundVerdict.B_DISCONNECT_LOSS,
  ] as RV[]
).map((v) => ({ value: v, label: verdictInfo(v).label }));

async function onEdit(r: RoundRecord, newVal: RV): Promise<void> {
  if (newVal === r.verdict) return;
  try {
    await ElMessageBox.confirm(
      t("history.editConfirmMsg", { n: r.round_no, label: verdictInfo(newVal).label }),
      t("history.editConfirmTitle"),
      { type: "warning", confirmButtonText: t("history.editConfirmBtn"), cancelButtonText: t("common.cancel") },
    );
    match.editVerdict(r.id, newVal);
  } catch {
    // 取消：恢复显示由数据驱动
  }
}

function levelsOf(r: RoundRecord) {
  return r.pick_snapshot.type === PickType.MULTI;
}

/** 序号两位补零（等宽字体下对齐：1→01，10→10）。 */
function p2(n: number): string {
  return String(n).padStart(2, "0");
}
</script>

<template>
  <el-drawer
    :model-value="props.modelValue"
    :title="$t('history.title')"
    direction="rtl"
    size="540px"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template #header>
      <div class="drawer-head">
        <span>{{ $t('history.title') }}</span>
        <el-button size="small" :loading="match.historyLoading" @click="match.refreshRounds()">
          {{ $t('history.refresh') }}
        </el-button>
      </div>
    </template>

    <div v-if="match.historyLoading" class="loading">{{ $t('history.loading') }}</div>

    <div v-if="sortedRounds.length === 0 && !match.historyLoading" class="empty">
      {{ $t('history.empty') }}
    </div>

    <div class="round-list">
      <div v-for="r in sortedRounds" :key="r.id" class="round-card">
        <div class="rc-head">
          <div class="rc-title">
            <span class="no">#{{ r.round_no }}</span>
            <b>{{ r.pick_snapshot.code }}</b>
            <span v-if="r.pick_snapshot.name" class="pname">· {{ r.pick_snapshot.name }}</span>
            <el-tag
              v-if="pickerOf(r.pick_snapshot.code)"
              size="small"
              effect="dark"
              :class="`pick-by by-${pickerOf(r.pick_snapshot.code)}`"
            >
              {{ $t('history.pickedBy', { side: pickerOf(r.pick_snapshot.code) }) }}
            </el-tag>
            <el-tag size="small" effect="plain">{{ pickTypeLabel(r.pick_snapshot.type) }}</el-tag>
            <el-tag size="small" :type="r.source === 2 ? ('warning' as const) : ('info' as const)" effect="plain">
              {{ roundSourceLabel(r.source) }}
            </el-tag>
            <el-tag
              v-if="!r.counted"
              size="small"
              type="info"
              effect="dark"
            >{{ $t('history.notCounted') }}</el-tag>
          </div>
          <div v-if="r.verdict != null" class="rc-verdict">
            <el-tag :type="verdictInfo(r.verdict).type" effect="dark">
              {{ verdictInfo(r.verdict).label }}
            </el-tag>
          </div>
        </div>

        <div class="score-line">
          <div class="side a">
            <div class="lab">A</div>
            <div class="val">{{ formatMs(r.score_a_ms ?? null) }}</div>
          </div>
          <div class="vs">vs</div>
          <div class="side b">
            <div class="lab">B</div>
            <div class="val">{{ formatMs(r.score_b_ms ?? null) }}</div>
          </div>
        </div>

        <div class="detail">
          <template v-if="levelsOf(r)">
            <div class="detail-col">
              <div class="dh tc-a">{{ $t('history.colMultiDetail', { side: $t('seat.a') }) }}</div>
              <div v-for="lv in r.state_a.completed_levels" :key="lv.level_index" class="dr">
                {{ $t('history.levelRow', { n: p2(lv.level_index + 1), time: formatMs(lv.time_ms) }) }}
                <span class="dim">{{ $t('history.cumulativeSuffix', { time: formatMs(lv.total_ms ?? null) }) }}</span>
              </div>
              <div v-if="r.state_a.forfeited" class="dim">{{ $t('playerStatus.forfeitShort') }}</div>
            </div>
            <div class="detail-col">
              <div class="dh tc-b">{{ $t('history.colMultiDetail', { side: $t('seat.b') }) }}</div>
              <div v-for="lv in r.state_b.completed_levels" :key="lv.level_index" class="dr">
                {{ $t('history.levelRow', { n: p2(lv.level_index + 1), time: formatMs(lv.time_ms) }) }}
                <span class="dim">{{ $t('history.cumulativeSuffix', { time: formatMs(lv.total_ms ?? null) }) }}</span>
              </div>
              <div v-if="r.state_b.forfeited" class="dim">{{ $t('playerStatus.forfeitShort') }}</div>
            </div>
          </template>
          <template v-else>
            <div class="detail-col">
              <div class="dh tc-a">{{ $t('history.colSingleAttempt', { side: $t('seat.a') }) }}</div>
              <div v-for="a in r.state_a.attempts" :key="a.index" class="dr" :class="{ invalid: a.status === AttemptStatus.INVALID }" :title="a.status === AttemptStatus.INVALID ? invalidReasonsTitle(a.invalid_reasons) : ''">
                {{ $t('history.attemptRow', { n: p2(a.index + 1), time: formatMs(a.time_ms ?? null) }) }}
                <span class="dim">{{ $t('history.attemptStatusParens', { status: attemptStatusLabel(a.status) }) }}</span>
              </div>
              <div v-if="r.state_a.forfeited" class="dim">{{ $t('playerStatus.forfeitShort') }}</div>
            </div>
            <div class="detail-col">
              <div class="dh tc-b">{{ $t('history.colSingleAttempt', { side: $t('seat.b') }) }}</div>
              <div v-for="a in r.state_b.attempts" :key="a.index" class="dr" :class="{ invalid: a.status === AttemptStatus.INVALID }" :title="a.status === AttemptStatus.INVALID ? invalidReasonsTitle(a.invalid_reasons) : ''">
                {{ $t('history.attemptRow', { n: p2(a.index + 1), time: formatMs(a.time_ms ?? null) }) }}
                <span class="dim">{{ $t('history.attemptStatusParens', { status: attemptStatusLabel(a.status) }) }}</span>
              </div>
              <div v-if="r.state_b.forfeited" class="dim">{{ $t('playerStatus.forfeitShort') }}</div>
            </div>
          </template>
        </div>

        <div v-if="r.verdict != null" class="edit-row">
          <span class="dim">{{ $t('history.editVerdictLabel') }}</span>
          <el-select
            :model-value="r.verdict"
            size="small"
            style="width: 200px"
            @change="(v: RV) => onEdit(r, v)"
          >
            <el-option
              v-for="o in verdictOptions"
              :key="o.value"
              :value="o.value"
              :label="o.label"
            />
          </el-select>
        </div>
      </div>
    </div>

    <!-- ban/pick/protect 阶段（整场一次；回合数据按从新到旧排列，故置于回合之后） -->
    <div
      v-if="draftSummary.bans.length || draftSummary.protects.length || draftSummary.tagBans.length"
      class="draft-stage round-card"
    >
      <div class="ds-title">{{ $t('history.draftStageTitle') }}</div>
      <div v-if="draftSummary.bans.length" class="ds-row">
        <span class="ds-label ban">{{ $t('history.draftBans') }}</span>
        <el-tag
          v-for="c in draftSummary.bans"
          :key="`ban-${c.code}`"
          size="small"
          effect="dark"
          :class="`by-${c.by}`"
        >{{ c.label }} · {{ c.by }}</el-tag>
      </div>
      <div v-if="draftSummary.protects.length" class="ds-row">
        <span class="ds-label protect">{{ $t('history.draftProtects') }}</span>
        <el-tag
          v-for="c in draftSummary.protects"
          :key="`prot-${c.code}`"
          size="small"
          effect="dark"
          :class="`by-${c.by}`"
        >{{ c.label }} · {{ c.by }}</el-tag>
      </div>
      <div v-if="draftSummary.tagBans.length" class="ds-row">
        <span class="ds-label tagban">{{ $t('history.draftTagBans') }}</span>
        <el-tag
          v-for="tb in draftSummary.tagBans"
          :key="`tagban-${tb.tag}`"
          size="small"
          effect="dark"
          :class="`by-${tb.by}`"
        >{{ tb.tag }} · {{ tb.by }}</el-tag>
      </div>
    </div>
  </el-drawer>
</template>

<style scoped>
.drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding-right: 12px;
}
.loading,
.empty {
  color: var(--tc-text-dim);
  text-align: center;
  padding: 30px 12px;
  font-size: 13px;
}
.round-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px 4px 24px;
}
.round-card {
  background: var(--tc-bg-soft);
  border: 1px solid var(--tc-border);
  border-radius: 10px;
  padding: 12px;
}
.rc-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}
.rc-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  flex-wrap: wrap;
}
.no {
  color: var(--tc-text-dim);
}
.pname {
  color: var(--tc-text-dim);
}
/* 本回合 pick 归属方徽标配色（A 蓝 / B 橙） */
.pick-by.by-A {
  --el-tag-bg-color: var(--tc-a);
  --el-tag-border-color: var(--tc-a);
  --el-tag-text-color: #fff;
  color: #fff;
}
.pick-by.by-B {
  --el-tag-bg-color: var(--tc-b);
  --el-tag-border-color: var(--tc-b);
  --el-tag-text-color: #fff;
  color: #fff;
}
/* ban/pick/protect 阶段卡（置于回合数据之后；回合从新到旧，此阶段为整场最初） */
.draft-stage {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 12px 4px 4px;
  font-size: 12px;
}
.ds-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--tc-text);
  letter-spacing: 0.3px;
}
.ds-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}
.ds-label {
  font-weight: 600;
  margin-right: 2px;
  flex-shrink: 0;
}
.ds-label.ban {
  color: var(--tc-b);
}
.ds-label.protect {
  color: var(--tc-a);
}
.ds-label.tagban {
  color: var(--tc-text-dim);
}
/* ban/protect/tagban chip 按执行方着色 */
.draft-stage .by-A {
  --el-tag-bg-color: var(--tc-a);
  --el-tag-border-color: var(--tc-a);
  --el-tag-text-color: #fff;
  color: #fff;
}
.draft-stage .by-B {
  --el-tag-bg-color: var(--tc-b);
  --el-tag-border-color: var(--tc-b);
  --el-tag-text-color: #fff;
  color: #fff;
}
.score-line {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 18px;
  padding: 6px 0;
  border-top: 1px dashed var(--tc-border);
  border-bottom: 1px dashed var(--tc-border);
}
.score-line .side {
  text-align: center;
}
.score-line .lab {
  font-size: 11px;
  color: var(--tc-text-dim);
}
.score-line .val {
  font-size: 20px;
  font-weight: 700;
  /* 时间值等宽，便于对齐与快速判读 */
  font-family: "SFMono-Regular", "Menlo", "Consolas", "Liberation Mono", monospace;
  font-variant-numeric: tabular-nums;
}
.score-line .a .val {
  color: var(--tc-a);
}
.score-line .b .val {
  color: var(--tc-b);
}
.vs {
  color: var(--tc-text-dim);
  font-size: 12px;
}
.detail {
  display: flex;
  gap: 12px;
  margin-top: 8px;
}
.detail-col {
  flex: 1;
}
.dh {
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 2px;
}
.dr {
  font-size: 12px;
  padding: 1px 0;
  /* 时间明细行等宽：关号与计时列对齐 */
  font-family: "SFMono-Regular", "Menlo", "Consolas", "Liberation Mono", monospace;
  font-variant-numeric: tabular-nums;
}
/* 无效尝试：红色删除线（时长保留作证据，不计分；原因见 title） */
.dr.invalid {
  color: #ff7a7a;
  text-decoration: line-through;
}
.dim {
  color: var(--tc-text-dim);
}
.edit-row {
  margin-top: 10px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
</style>

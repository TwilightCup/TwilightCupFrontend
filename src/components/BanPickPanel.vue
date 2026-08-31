<script setup lang="ts">
import { computed, h, ref } from "vue";
import { useI18n } from "vue-i18n";
import { ElMessage, ElMessageBox } from "element-plus";
import { useDraftStore, type Side } from "@/stores/draft";
import { useMatchStore } from "@/stores/match";
import { MatchPhase, PickType, type Pick } from "@/api/types";
import { categoryKindInfo } from "@/utils/format";

/**
 * 裁判端 ban/pick 工作台：按文档流程引导裁判手动操作，前端校验规则。
 * 仅在图池已载入时显示（否则回退到 PrepPanel 的手动输入）。
 */
const { t } = useI18n();
const draft = useDraftStore();
const match = useMatchStore();

// 草稿阶段标签：通过 i18n 解析（STAGE_KEY → banpick.stage.*）。
const STAGE_KEY: Record<string, string> = {
  LOAD: "load",
  ROLL: "roll",
  TAG_BAN: "tagBan",
  DRAFT: "draft",
  PICK: "pick",
  PREP: "prep",
  TB_FORCE: "tbForce",
};
function stageLabel(stage: string | undefined): string {
  if (!stage) return stage ?? "";
  const key = STAGE_KEY[stage];
  return key ? t(`banpick.stage.${key}`) : stage;
}

// --- LOAD ---
const importText = ref("");
function onImport(): void {
  const err = draft.importMappoolJson(importText.value);
  if (err) ElMessage.warning(err);
  else {
    ElMessage.success(t("banpick.mappoolImported"));
    importText.value = "";
  }
}
function retryLoad(): void {
  if (match.matchId && draft.token) draft.loadFromMatch(match.matchId, draft.token);
}

// --- ROLL ---
const rollA = ref<number | null>(null);
const rollB = ref<number | null>(null);
function applyRolls(): void {
  if (rollA.value == null || rollB.value == null) return;
  draft.setRolls(rollA.value, rollB.value);
}
const tagBanSide = computed<Side | null>(() => {
  const f = draft.state.banFirst;
  if (!f) return null;
  if (!draft.state.tagBanActed[f]) return f;
  const o = f === "A" ? "B" : "A";
  return draft.state.tagBanActed[o] ? null : o;
});

// --- DRAFT：选图状态 ---
function pickClasses(p: Pick): Record<string, boolean> {
  const st = draft.mapStatus(p.code);
  const slot = draft.currentSlot;
  const clickable =
    draft.state.stage === "DRAFT" &&
    slot != null &&
    st.bannedBy == null &&
    st.protectedBy == null &&
    st.pickedBy == null;
  const err = clickable ? draft.validateChoice(p.code) : null;
  return {
    pick: true,
    banned: st.bannedBy != null,
    protected: st.protectedBy != null,
    picked: st.pickedBy != null,
    pickable: draft.state.stage === "PICK" && draft.legalPicks.some((x) => x.code === p.code),
    "draft-clickable": clickable && !err,
    "draft-blocked": clickable && !!err,
  };
}

/** 选图状态徽标：ban / protect / picked，并标明是哪一方（A/B 配色）。 */
function statusBadge(code: string): { text: string; cls: string } | null {
  const st = draft.mapStatus(code);
  if (st.pickedBy) return { text: `picked · ${st.pickedBy}`, cls: `st-pick by-${st.pickedBy}` };
  if (st.bannedBy) return { text: `ban · ${st.bannedBy}`, cls: `st-ban by-${st.bannedBy}` };
  if (st.protectedBy) return { text: `protect · ${st.protectedBy}`, cls: `st-prot by-${st.protectedBy}` };
  return null;
}
function onPickClick(p: Pick): void {
  if (draft.state.stage === "DRAFT") {
    const err = draft.validateChoice(p.code);
    if (err) {
      ElMessage.warning(err);
      return;
    }
    draft.chooseMap(p.code);
  } else if (draft.state.stage === "PICK") {
    if (!draft.legalPicks.some((x) => x.code === p.code)) return;
    void confirmPickFlow(p);
  }
}
async function confirmPick(code: string): Promise<void> {
  try {
    await ElMessageBox.confirm(t("banpick.pickConfirmMsg", { code: draft.codeLabel(code) }), t("banpick.pickConfirmTitle"), {
      type: "warning",
      confirmButtonText: t("banpick.pickConfirmBtn"),
      cancelButtonText: t("common.cancel"),
    });
  } catch {
    return;
  }
  draft.confirmPick(code);
}

// --- PICK（词条 + 重试）：CT/EX 选图先弹词条/重试选择，CP 自动 Checkpoint，确认后随 selectPick 提交 ---
const ctDialogVisible = ref(false);
const ctDialogCode = ref<string | null>(null);
const ctDialogTags = ref<string[]>([]);
const ctDialogRetry = ref<number | null>(null);

function isCtPick(p: Pick): boolean {
  const k = draft.kindOfCode(p.code);
  return k === "CT" || k === "EX";
}

/** 词条候选：CT 过滤本场已 ban，EX 不受禁用词条约束；单关含 Achievement。 */
const ctDialogOptions = computed<{ value: string; disabled: boolean }[]>(() => {
  const code = ctDialogCode.value;
  const p = code ? draft.pickByCode(code) : null;
  const single = p?.type === PickType.SINGLE;
  const isEx = code ? draft.kindOfCode(code) === "EX" : false;
  const known = single
    ? [...draft.ctTagChoices, "Achievement"]
    : [...draft.ctTagChoices];
  return known
    .filter((tg) => isEx || !draft.state.bannedTags.includes(tg))
    .map((tg) => ({
      value: tg,
      disabled: (tg === "Checkpoint" && ctDialogTags.value.includes("No Checkpoint")) ||
        (tg === "No Checkpoint" && ctDialogTags.value.includes("Checkpoint")),
    }));
});

/** 弹窗内是否需要（必填）重试次数：CT/EX 单关。 */
const ctDialogNeedsRetry = computed(() =>
  ctDialogCode.value ? draft.needsRefereeRetry(ctDialogCode.value) : false,
);

async function confirmPickFlow(p: Pick): Promise<void> {
  const kind = draft.kindOfCode(p.code);
  // CP：自动携带 Checkpoint 词条（不可改），普通确认流程
  if (kind === "CP") {
    try {
      await ElMessageBox.confirm(
        t("banpick.pickConfirmMsg", { code: draft.codeLabel(p.code) }),
        t("banpick.pickConfirmTitle"),
        { type: "warning", confirmButtonText: t("banpick.pickConfirmBtn"), cancelButtonText: t("common.cancel") },
      );
    } catch {
      return;
    }
    draft.confirmPickWithOptions(p.code, ["Checkpoint"]);
    return;
  }
  // CT/EX：弹词条 + 重试选择（ct_tag_count=0 时词条区隐藏，仅剩重试必填）
  if (isCtPick(p) && (draft.ctTagCount > 0 || draft.needsRefereeRetry(p.code))) {
    ctDialogCode.value = p.code;
    ctDialogTags.value = [];
    ctDialogRetry.value = null;
    ctDialogVisible.value = true;
    return;
  }
  await confirmPick(p.code);
}

function submitCtPick(): void {
  const code = ctDialogCode.value;
  if (!code) return;
  if (ctDialogNeedsRetry.value && (ctDialogRetry.value == null || ctDialogRetry.value < 1)) {
    ElMessage.warning(t("banpick.pickRetryRequired"));
    return;
  }
  ctDialogVisible.value = false;
  draft.confirmPickWithOptions(code, [...ctDialogTags.value], ctDialogRetry.value ?? undefined);
}

// --- PREP / 开局 ---
/** 预载徽标（preload_state）：done/na/absent/failed/in_progress → 标签样式与文案键 */
function preloadTag(st: string): { type: "success" | "warning" | "danger" | "info"; key: string } {
  switch (st) {
    case "done":
      return { type: "success", key: "preload.done" };
    case "in_progress":
      return { type: "warning", key: "preload.inProgress" };
    case "failed":
      return { type: "danger", key: "preload.failed" };
    default:
      return { type: "info", key: "preload.none" };
  }
}

async function onManualStart(): Promise<void> {
  // 存在预载未完席位时，确认框追加强制开始的后果提示
  const message = match.preloadIncomplete
    ? h("div", null, [
        h("div", null, t("banpick.bpManualStartMsg")),
        h("div", { style: "margin-top: 8px;" }, t("prep.preloadIncompleteWarning")),
      ])
    : t("banpick.bpManualStartMsg");
  try {
    await ElMessageBox.confirm(message, t("banpick.bpManualStartTitle"), {
      type: "warning",
      confirmButtonText: t("banpick.bpManualStartBtn"),
      cancelButtonText: t("common.cancel"),
    });
  } catch {
    return;
  }
  draft.manualStart();
}

const stage = computed(() => draft.state.stage);
const showPrepUi = computed(() => match.phase === MatchPhase.PREP);
</script>

<template>
  <section class="panel bp">
    <div v-if="stage !== 'PREP'" class="bp-head">
      <div class="bp-title">
        <span class="bp-stage">{{ stageLabel(stage) }}</span>
        <el-tag size="small" type="warning" effect="dark">
          {{ $t('banpick.banProtectCounts', { ban: draft.banCount, protect: draft.protectCount }) }}
        </el-tag>
      </div>
    </div>

    <!-- LOAD -->
    <div v-if="stage === 'LOAD'" class="block">
      <el-alert v-if="draft.loadError" type="warning" :closable="false" show-icon class="mb8">
        {{ $t('banpick.loadFailedAlert', { error: draft.loadError }) }}
      </el-alert>
      <div class="row-label">{{ $t('banpick.importJsonLabel') }}</div>
      <el-input
        v-model="importText"
        type="textarea"
        :autosize="{ minRows: 3, maxRows: 10 }"
        placeholder='{"categories":[{"name":"ML","picks":[...]}, ...]}'
      />
      <div class="btn-row">
        <el-button type="primary" @click="onImport">{{ $t('banpick.importJsonBtn') }}</el-button>
        <el-button @click="retryLoad">{{ $t('banpick.retryLoadBtn') }}</el-button>
      </div>
    </div>

    <!-- 开始比赛（CREATED → RUNNING，激活后选手可连入摇点） -->
    <div v-else-if="draft.needsStart" class="block start-gate">
      <div class="row-label">{{ $t('banpick.notStartedLabel') }}</div>
      <p class="tip">
        {{ $t('banpick.startMatchTip') }}
      </p>
      <el-button type="primary" size="large" @click="draft.startMatch()">{{ $t('banpick.startMatchBtn') }}</el-button>
    </div>

    <!-- ROLL -->
    <div v-else-if="stage === 'ROLL'" class="block">
      <div class="row-label">{{ $t('banpick.rollInstructions') }}</div>
      <div class="roll-row">
        <div class="roll a">
          <span class="who">{{ match.playerNames.A || $t('seat.a') }}</span>
          <el-input-number v-model="rollA" :min="1" :max="100" controls-position="right" />
        </div>
        <div class="roll b">
          <span class="who">{{ match.playerNames.B || $t('seat.b') }}</span>
          <el-input-number v-model="rollB" :min="1" :max="100" controls-position="right" />
        </div>
        <el-button type="primary" :disabled="rollA == null || rollB == null" @click="applyRolls">{{ $t('banpick.confirmRollsBtn') }}</el-button>
      </div>
      <div v-if="draft.rollTie" class="tip warn">{{ $t('banpick.rollTieWarning', { val: draft.state.rollA }) }}</div>
      <template v-if="draft.highRoller && !draft.rollTie">
        <div class="mt8">
          <span class="dim">{{ $t('banpick.highRollerLabel') }}</span><b>{{ draft.nameOf(draft.highRoller) }}</b>
          <span v-if="draft.state.pickFirst == null" class="choose">
            {{ $t('banpick.choosePickOrder') }}
            <el-button size="small" @click="draft.decidePickFirst(draft.highRoller!)">{{ $t('banpick.firstPick') }}</el-button>
            <el-button size="small" @click="draft.decidePickFirst(draft.highRoller === 'A' ? 'B' : 'A')">{{ $t('banpick.lastPick') }}</el-button>
          </span>
          <span v-else class="dim">{{ $t('banpick.firstPickerResult', { name: draft.nameOf(draft.state.pickFirst) }) }}</span>
        </div>
        <div class="mt8">
          <span class="dim">{{ $t('banpick.lowRollerLabel') }}</span><b>{{ draft.nameOf(draft.lowRoller!) }}</b>
          <span v-if="draft.state.banFirst == null" class="choose">
            {{ $t('banpick.chooseBanOrder') }}
            <el-button size="small" @click="draft.decideBanFirst(draft.lowRoller!)">{{ $t('banpick.firstBan') }}</el-button>
            <el-button size="small" @click="draft.decideBanFirst(draft.lowRoller === 'A' ? 'B' : 'A')">{{ $t('banpick.lastBan') }}</el-button>
          </span>
          <span v-else class="dim">{{ $t('banpick.firstBannerResult', { name: draft.nameOf(draft.state.banFirst) }) }}</span>
        </div>
      </template>
    </div>

    <!-- TAG_BAN -->
    <div v-else-if="stage === 'TAG_BAN'" class="block">
      <div class="row-label">{{ $t('banpick.tagBanInstructions') }}</div>
      <div v-if="draft.ctTagChoices.length === 0" class="tip">
        {{ $t('banpick.noCtTagsTip') }}
        <el-button size="small" type="primary" plain @click="draft.skipTagBan()">{{ $t('banpick.skipToDraftBtn') }}</el-button>
      </div>
      <div class="tag-ban-info">
        {{ $t('banpick.currentTurn', { name: tagBanSide ? draft.nameOf(tagBanSide) : '—' }) }}
      </div>
      <div class="tag-row">
        <el-tag
          v-for="t in draft.ctTagChoices"
          :key="t"
          :type="draft.state.bannedTags.includes(t) ? 'danger' : 'info'"
          :effect="draft.state.bannedTags.includes(t) ? 'dark' : 'plain'"
          class="tag-chip"
          :class="{ disabled: tagBanSide == null || draft.state.bannedTags.includes(t) }"
          @click="tagBanSide && !draft.state.bannedTags.includes(t) && draft.banTag(tagBanSide, t)"
        >
          {{ t }}
        </el-tag>
        <el-button
          v-if="tagBanSide"
          size="small"
          plain
          @click="draft.banTag(tagBanSide, null)"
        >{{ $t('banpick.giveUpBtn') }}</el-button>
      </div>
    </div>

    <!-- DRAFT -->
    <div v-else-if="stage === 'DRAFT'" class="block">
      <div class="bp-head-row">
        <div class="row-label">{{ $t('banpick.draftInstructions', { bans: draft.banCount, protects: draft.protectCount }) }}</div>
      </div>
      <div class="slot-info">
        <template v-if="draft.currentSlot">
          <b :class="`side-${draft.currentSlot.side}`">{{ $t('banpick.draftCurrentActor', { name: draft.nameOf(draft.currentSlot.side) }) }}</b>
          {{ $t('banpick.draftExecutes') }} <el-tag size="small" :type="draft.currentSlot.kind === 'ban' ? 'danger' : 'success'">{{
            draft.currentSlot.kind === "ban" ? $t('banpick.tagBan') : $t('banpick.tagProtect')
          }}</el-tag>{{ $t('banpick.draftStepCounter', { step: draft.currentSlot.index + 1, total: draft.draftSlots.length }) }}
        </template>
        <template v-else>{{ $t('banpick.draftCompleted') }}</template>
        <el-button size="small" plain :disabled="draft.state.actions.length === 0" @click="draft.undoLastAction()">{{ $t('banpick.undoLastActionBtn') }}</el-button>
      </div>
      <div class="mappool-grid">
        <div v-for="cat in draft.mappool?.categories" :key="cat.name" class="cat-block">
          <div class="cat-title">
            <el-tag v-if="categoryKindInfo(cat.name)" size="small" :type="categoryKindInfo(cat.name)!.type" effect="dark">
              {{ categoryKindInfo(cat.name)!.short }}
            </el-tag>
            <span class="cat-name">{{ cat.name }}</span>
          </div>
          <div class="picks-row">
            <div
              v-for="p in cat.picks"
              :key="p.code"
              :class="pickClasses(p)"
              @click="onPickClick(p)"
            >
              <div class="p-code">{{ p.code }}</div>
              <div class="p-name">{{ p.name || $t('common.dash') }}</div>
              <div class="p-status">
                <span v-if="statusBadge(p.code)" :class="statusBadge(p.code)!.cls">{{ statusBadge(p.code)!.text }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- PICK -->
    <div v-else-if="stage === 'PICK'" class="block">
      <div class="row-label">
        <b :class="`side-${draft.state.nextPicker}`">{{ $t('banpick.pickInstructions', { name: draft.state.nextPicker ? draft.nameOf(draft.state.nextPicker) : '—' }) }}</b>
      </div>
      <div class="btn-row">
        <el-button @click="draft.startPickTimer()">{{ $t('banpick.startPickTimerBtn') }}</el-button>
        <el-button type="warning" plain :disabled="draft.legalPicks.length === 0" @click="draft.randomPick()">{{ $t('banpick.randomPickBtn') }}</el-button>
      </div>
      <div class="tip">{{ $t('banpick.pickInstructionsTip') }}</div>
      <div class="tip">{{ $t('banpick.pickCtTagTip') }}</div>
      <div class="mappool-grid">
        <div v-for="cat in draft.mappool?.categories" :key="cat.name" class="cat-block">
          <div class="cat-title">
            <el-tag v-if="categoryKindInfo(cat.name)" size="small" :type="categoryKindInfo(cat.name)!.type" effect="dark">
              {{ categoryKindInfo(cat.name)!.short }}
            </el-tag>
            <span class="cat-name">{{ cat.name }}</span>
          </div>
          <div class="picks-row">
            <div
              v-for="p in cat.picks"
              :key="p.code"
              :class="pickClasses(p)"
              @click="onPickClick(p)"
            >
              <div class="p-code">{{ p.code }}</div>
              <div class="p-name">{{ p.name || $t('common.dash') }}</div>
              <div class="p-status">
                <span v-if="statusBadge(p.code)" :class="statusBadge(p.code)!.cls">{{ statusBadge(p.code)!.text }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- TB_FORCE -->
    <div v-else-if="stage === 'TB_FORCE'" class="block">
      <el-alert type="error" :closable="false" show-icon class="mb8">
        {{ $t('banpick.tbForceAlert', { code: draft.tbCode }) }}
      </el-alert>
      <el-button type="danger" @click="draft.forceTB()">{{ $t('banpick.forceTbBtn') }}</el-button>
    </div>

    <!-- PREP -->
    <div v-else-if="stage === 'PREP'" class="block">
      <div class="row-label">
        <b>{{ $t('banpick.prepPickConfirmed', { code: match.pendingPickCode }) }}</b>
        <span v-if="match.pickInfo[match.pendingPickCode ?? '']?.name" class="dim">
          · {{ match.pickInfo[match.pendingPickCode ?? ""]?.name }}
        </span>
        <template v-if="match.pendingTags.length > 0">
          <el-tag
            v-for="tg in match.pendingTags"
            :key="tg"
            size="small"
            type="warning"
            effect="plain"
            class="prep-tag"
          >{{ tg }}</el-tag>
        </template>
      </div>

      <div class="btn-row">
        <el-button @click="draft.startPrepTimer()">{{ $t('banpick.startPrepTimerBtn') }}</el-button>
      </div>
      <div class="ready-row">
        <div class="ready a" :class="{ on: match.aReady }">
          <span class="who">{{ match.playerNames.A || $t('seat.a') }}</span>
          <span class="ready-tags">
            <el-tag :type="match.aReady ? ('success' as const) : ('info' as const)" effect="dark">{{ match.aReady ? $t('playerStatus.ready') : $t('playerStatus.notReady') }}</el-tag>
            <el-tag :type="preloadTag(match.aPreload).type" effect="plain">{{ $t(preloadTag(match.aPreload).key) }}</el-tag>
          </span>
        </div>
        <div class="ready b" :class="{ on: match.bReady }">
          <span class="who">{{ match.playerNames.B || $t('seat.b') }}</span>
          <span class="ready-tags">
            <el-tag :type="match.bReady ? ('success' as const) : ('info' as const)" effect="dark">{{ match.bReady ? $t('playerStatus.ready') : $t('playerStatus.notReady') }}</el-tag>
            <el-tag :type="preloadTag(match.bPreload).type" effect="plain">{{ $t(preloadTag(match.bPreload).key) }}</el-tag>
          </span>
        </div>
      </div>
      <div class="btn-row mt8 prep-actions">
        <el-button type="warning" size="large" :disabled="!showPrepUi" @click="onManualStart">{{ $t('banpick.manualStartNoInterruptBtn') }}</el-button>
        <el-button size="small" plain @click="draft.cancelPick()">{{ $t('banpick.cancelPickBtn') }}</el-button>
      </div>
      <div v-if="!showPrepUi" class="tip">{{ $t('banpick.waitForPrepTip') }}</div>
    </div>

    <div v-if="stage !== 'PREP'" class="bp-foot">
      <el-button size="small" plain @click="draft.resetDraft()">{{ $t('banpick.resetDraftBtn') }}</el-button>
    </div>

    <!-- CT/EX 选图词条 + 重试选择弹窗（PICK 阶段点选 CT/EX 图后弹出） -->
    <el-dialog
      v-model="ctDialogVisible"
      :title="$t('banpick.ctTagDialogTitle', { code: ctDialogCode })"
      width="420px"
      append-to-body
    >
      <template v-if="draft.ctTagCount > 0">
        <p class="ct-dialog-tip">{{ $t('banpick.ctTagDialogTip', { n: draft.ctTagCount }) }}</p>
        <el-select
          v-model="ctDialogTags"
          multiple
          collapse-tags
          :multiple-limit="draft.ctTagCount"
          :placeholder="$t('banpick.ctTagPlaceholder')"
          class="ct-dialog-select"
        >
          <el-option
            v-for="o in ctDialogOptions"
            :key="o.value"
            :value="o.value"
            :label="o.value"
            :disabled="o.disabled"
          />
        </el-select>
      </template>
      <template v-if="ctDialogNeedsRetry">
        <p class="ct-dialog-tip">{{ $t('banpick.pickRetryLabel') }}</p>
        <el-input-number
          v-model="ctDialogRetry"
          :min="1"
          controls-position="right"
          class="ct-dialog-select"
        />
      </template>
      <template #footer>
        <el-button @click="ctDialogVisible = false">{{ $t('common.cancel') }}</el-button>
        <el-button
          type="primary"
          :disabled="ctDialogNeedsRetry && (ctDialogRetry == null || ctDialogRetry < 1)"
          @click="submitCtPick"
        >
          {{ $t('banpick.pickConfirmBtn') }}
        </el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.panel.bp {
  background: var(--tc-bg-soft);
  border: 1px solid var(--tc-border);
  border-radius: 10px;
  padding: 14px 16px;
  margin-bottom: 12px;
}
.bp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.bp-title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.bp-stage {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 1px;
}
.block {
  margin-bottom: 12px;
}
.row-label {
  font-size: 12px;
  color: var(--tc-text-dim);
  margin-bottom: 6px;
}
.tip {
  font-size: 12px;
  color: var(--tc-text-dim);
  margin-top: 6px;
}
.tip.warn {
  color: #ffb84d;
}
.dim {
  color: var(--tc-text-dim);
}
.mb8 {
  margin-bottom: 8px;
}
.mt8 {
  margin-top: 8px;
}
.btn-row {
  display: flex;
  gap: 8px;
  margin-top: 6px;
  flex-wrap: wrap;
}
/* ROLL */
.roll-row {
  display: flex;
  align-items: center;
  gap: 14px;
}
.roll {
  display: flex;
  align-items: center;
  gap: 8px;
}
.roll .who {
  font-weight: 600;
}
.roll.a .who {
  color: var(--tc-a);
}
.roll.b .who {
  color: var(--tc-b);
}
.choose {
  margin-left: 8px;
  display: inline-flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
/* TAG_BAN */
.tag-ban-info {
  font-size: 13px;
  margin-bottom: 6px;
}
.tag-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.tag-chip {
  cursor: pointer;
  user-select: none;
}
.tag-chip.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
/* DRAFT */
.bp-head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  flex-wrap: wrap;
  gap: 8px;
}
.slot-info {
  font-size: 13px;
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}
.side-A {
  color: var(--tc-a);
}
.side-B {
  color: var(--tc-b);
}
.mappool-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.cat-block {
  background: var(--tc-hover);
  border: 1px solid var(--tc-border);
  border-radius: 8px;
  padding: 8px 10px;
}
.cat-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.cat-name {
  font-size: 12px;
  color: var(--tc-text-dim);
}
.picks-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.pick {
  width: 120px;
  background: var(--tc-bg);
  border: 1px solid var(--tc-border);
  border-radius: 8px;
  padding: 6px 8px;
  cursor: default;
  transition: border-color 0.15s, opacity 0.15s;
}
.pick .p-code {
  font-size: 13px;
  font-weight: 700;
}
.pick .p-name {
  font-size: 11px;
  color: var(--tc-text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pick .p-status {
  font-size: 10px;
  margin-top: 2px;
  font-weight: 700;
}
.pick .p-status .by-a {
  color: var(--tc-a);
}
.pick .p-status .by-b {
  color: var(--tc-b);
}
.pick.draft-clickable {
  cursor: pointer;
  border-color: #3a7bd5;
}
.pick.draft-clickable:hover {
  border-color: #5a9bff;
}
.pick.draft-blocked {
  opacity: 0.5;
}
.pick.banned {
  border-color: #6a2b2b;
  opacity: 0.6;
}
.pick.protected {
  border-color: #2b6a3a;
}
.pick.picked {
  border-color: #5b6478;
  opacity: 0.65;
  cursor: not-allowed;
}
.pick.pickable {
  cursor: pointer;
  border-color: #37d27a;
}
.pick.pickable:hover {
  border-color: #5cff9a;
}
/* PREP */
.ready-row {
  display: flex;
  gap: 12px;
  margin-top: 6px;
}
.ready {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--tc-hover);
  border: 1px solid var(--tc-border);
}
.ready.on {
  border-color: #37d27a;
}
.ready .who {
  font-weight: 600;
}
.ready-tags {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.prep-actions {
  align-items: flex-end;
}
.ready.a .who {
  color: var(--tc-a);
}
.ready.b .who {
  color: var(--tc-b);
}
.bp-foot {
  margin-top: 10px;
  display: flex;
  justify-content: flex-end;
}
/* PREP：CT 词条 */
.prep-tag {
  margin-left: 6px;
}
.tag-block {
  margin: 8px 0;
}
.tag-select {
  flex: 1;
  min-width: 200px;
}
.retry-input {
  width: 120px;
  flex-shrink: 0;
}
/* CT 词条弹窗 */
.ct-dialog-tip {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--tc-text-dim);
}
.ct-dialog-select {
  width: 100%;
}
</style>

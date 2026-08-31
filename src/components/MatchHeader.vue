<script setup lang="ts">
import { computed } from "vue";
import { ElMessageBox } from "element-plus";
import { useI18n } from "vue-i18n";
import { useMatchStore } from "@/stores/match";
import { useDraftStore } from "@/stores/draft";
import { MatchPhase } from "@/api/types";
import { phaseInfo, type TagType } from "@/utils/format";
import RoleSwitcher from "@/components/RoleSwitcher.vue";
import AccountMenu from "@/components/AccountMenu.vue";
import type { ConnStatus } from "@/ws/socket";

const emit = defineEmits<{
  (e: "open-history"): void;
  (e: "logout"): void;
  (e: "back"): void;
}>();

const { t } = useI18n();
const match = useMatchStore();
const draft = useDraftStore();

const phase = computed(() => phaseInfo(match.phase));

/** 胜方用户名（matchWinner 为 "A"/"B"） */
const winnerId = computed(() =>
  match.matchWinner ? match.playerNames[match.matchWinner] : "",
);

/** ban/pick 子阶段标签：仅在图池已载入且处于 ban/pick/准备阶段时显示。 */
const draftStageTag = computed<{ label: string; type: TagType } | null>(() => {
  if (!draft.mappool) return null;
  const ph = match.phase;
  const inDraft =
    ph === MatchPhase.IDLE ||
    ph === MatchPhase.ROUND_END ||
    ph === MatchPhase.PREP;
  if (!inDraft) return null;
  const map: Record<string, { label: string; type: TagType }> = {
    ROLL: { label: t("banpick.stage.roll"), type: "info" },
    TAG_BAN: { label: t("banpick.stage.tagBan"), type: "warning" },
    DRAFT: { label: t("banpick.stage.draft"), type: "primary" },
    PICK: { label: t("banpick.stage.pick"), type: "success" },
    PREP: { label: t("banpick.stage.prep"), type: "warning" },
    TB_FORCE: { label: t("banpick.stage.tbForce"), type: "danger" },
    LOAD: { label: t("banpick.stage.load"), type: "info" },
  };
  return map[draft.state.stage] ?? null;
});

const connInfo = computed<{ dot: string; text: string }>((() => {
  const s: ConnStatus = match.connStatus;
  switch (s) {
    case "open":
      return { dot: "#37d27a", text: t("conn.connected") };
    case "connecting":
      return { dot: "#f0a020", text: t("conn.connecting") };
    case "reconnecting":
      return { dot: "#f0a020", text: t("conn.reconnecting") };
    case "closed":
      return { dot: "#ff5c5c", text: t("conn.closed") };
    case "displaced":
      return { dot: "#ff5c5c", text: t("conn.displaced") };
    default:
      return { dot: "#6b7280", text: t("conn.unknown") };
  }
}));

/** 暂停比赛：RUNNING → PAUSED（保留进度，释放选手）。需二次确认。 */
async function onPause(): Promise<void> {
  try {
    await ElMessageBox.confirm(
      t("matchHeader.pauseConfirmMsg"),
      t("matchHeader.pauseConfirmTitle"),
      { type: "warning", confirmButtonText: t("matchHeader.pauseBtn"), cancelButtonText: t("common.cancel") },
    );
  } catch {
    return;
  }
  await draft.pauseMatch();
}

/** 恢复比赛：PAUSED → RUNNING；若选手已在其他进行中比赛，后端返回 409 并由 store 弹出错误。 */
async function onResume(): Promise<void> {
  await draft.resumeMatch();
}
</script>

<template>
  <header class="match-header">
    <div class="left">
      <div class="title-block">
        <img src="/logo.png" class="logo" alt="logo" />
        <div>
          <div class="match-name">{{ match.matchName || $t('matchHeader.unnamed') }}</div>
          <div class="meta">
            <span v-if="match.boFormat">BO{{ match.boFormat }}</span>
            <span v-if="match.winThreshold">· {{ $t('matchHeader.winThreshold', { n: match.winThreshold }) }}</span>
            <span v-if="match.scoringMethodName"
              >· {{ $t('matchHeader.scoringMethodLabel') }}{{
                match.scoringMethodName === "FASTEST" ? $t('scoring.fastest') : $t('scoring.average')
              }}</span
            >
            <span v-if="match.countdownDelay != null"
              >· {{ $t('matchHeader.delay', { n: match.countdownDelay }) }}</span
            >
          </div>
        </div>
      </div>
      <div class="phase-tags">
        <el-tag :type="phase.type" effect="dark" size="large" class="phase-tag">
          {{ phase.label }}
        </el-tag>
        <el-tag
          v-if="draftStageTag"
          :type="draftStageTag.type"
          effect="plain"
          size="large"
          class="phase-tag"
        >
          {{ draftStageTag.label }}
        </el-tag>
      </div>
    </div>

    <div class="center">
      <div class="score">
        <div class="side a">
          <div class="label">{{ match.playerNames.A || $t('seat.a') }}</div>
          <div class="num">{{ match.winsA }}</div>
        </div>
        <div class="vs">:</div>
        <div class="side b">
          <div class="label">{{ match.playerNames.B || $t('seat.b') }}</div>
          <div class="num">{{ match.winsB }}</div>
        </div>
      </div>
      <div v-if="match.matchWinner" class="winner">
        🏆 {{ $t('matchHeader.winnerLabel', { name: winnerId || match.matchWinner }) }}
      </div>
    </div>

    <div class="right">
      <div class="conn" :title="$t('conn.statusTooltip', { text: connInfo.text })">
        <span class="dot" :style="{ background: connInfo.dot }" />
        <span>{{ connInfo.text }}</span>
      </div>
      <div class="actions">
        <el-button v-if="!match.matchEnded && draft.canPause" size="small" type="warning" plain @click="onPause">
          {{ $t('matchHeader.pauseMatchBtn') }}
        </el-button>
        <el-button v-if="!match.matchEnded && draft.canResume" size="small" type="success" plain @click="onResume">
          {{ $t('matchHeader.resumeMatchBtn') }}
        </el-button>
        <el-button size="small" @click="emit('open-history')">{{ $t('matchHeader.dataViewBtn') }}</el-button>
        <el-button size="small" @click="emit('back')">{{ $t('matchHeader.myMatchesBtn') }}</el-button>
        <RoleSwitcher />
        <AccountMenu @logout="emit('logout')" />
      </div>
    </div>
  </header>
</template>

<style scoped>
.match-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 18px;
  background: var(--tc-bg-soft);
  border-bottom: 1px solid var(--tc-border);
}
.left,
.right {
  display: flex;
  align-items: center;
  gap: 14px;
  flex: 1;
}
.right {
  justify-content: flex-end;
}
.title-block {
  display: flex;
  align-items: center;
  gap: 12px;
}
.phase-tags {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: center;
}
.logo {
  width: 26px;
  height: 26px;
  object-fit: contain;
}
.match-name {
  font-size: 16px;
  font-weight: 600;
}
.meta {
  color: var(--tc-text-dim);
  font-size: 12px;
}
.center {
  text-align: center;
}
.score {
  display: flex;
  align-items: center;
  gap: 18px;
}
.score .side {
  text-align: center;
  min-width: 56px;
}
.score .label {
  font-size: 12px;
  color: var(--tc-text-dim);
}
.score .num {
  font-size: 30px;
  font-weight: 700;
  line-height: 1.1;
}
.side.a .num {
  color: var(--tc-a);
}
.side.b .num {
  color: var(--tc-b);
}
.vs {
  font-size: 22px;
  color: var(--tc-text-dim);
}
.winner {
  margin-top: 4px;
  font-size: 13px;
  color: var(--tc-primary);
}
.phase-tag {
  min-width: 92px;
  justify-content: center;
}
.conn {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--tc-text-dim);
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}
.actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>

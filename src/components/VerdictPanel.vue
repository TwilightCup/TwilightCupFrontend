<script setup lang="ts">
import { computed } from "vue";
import { ElMessageBox } from "element-plus";
import { useI18n } from "vue-i18n";
import { useMatchStore } from "@/stores/match";
import { RoundVerdict, MatchPhase } from "@/api/types";
import { verdictInfo, pickTypeLabel } from "@/utils/format";

const { t } = useI18n();
const match = useMatchStore();

/** 方 → 选手用户名（兜底"选手A/B"），用于把判定按钮的"选手A/B"换成实际用户名 */
function idOf(side: "A" | "B"): string {
  return match.playerNames[side] || (side === "A" ? t("seat.a") : t("seat.b"));
}

const verdicts = computed<{ v: RoundVerdict; label: string; kind: string }[]>(() => [
  { v: RoundVerdict.A_WIN, label: t("verdictPanel.winLabel", { name: idOf("A") }), kind: "a" },
  { v: RoundVerdict.B_WIN, label: t("verdictPanel.winLabel", { name: idOf("B") }), kind: "b" },
  { v: RoundVerdict.TIE_REMATCH, label: t("verdict.tieShort"), kind: "tie" },
]);

const disconnectVerdicts: RoundVerdict[] = [
  RoundVerdict.A_DISCONNECT_LOSS,
  RoundVerdict.B_DISCONNECT_LOSS,
];

/** 断连判负 label：把"A/B"换成账号 id */
function disconnectLabel(v: RoundVerdict): string {
  if (v === RoundVerdict.A_DISCONNECT_LOSS) return t("verdictPanel.disconnectLossLabel", { name: idOf("A") });
  if (v === RoundVerdict.B_DISCONNECT_LOSS) return t("verdictPanel.disconnectLossLabel", { name: idOf("B") });
  return verdictInfo(v).label;
}

const isJudging = computed(() => match.phase === MatchPhase.ROUND_JUDGING);
const isInRound = computed(() => match.phase === MatchPhase.IN_ROUND);

const pickType = computed(() => {
  const code = match.currentPick?.code;
  if (code && match.pickInfo[code]?.type != null) {
    return pickTypeLabel(match.pickInfo[code]!.type as number);
  }
  return "";
});

async function onVerdict(v: RoundVerdict): Promise<void> {
  const info = verdictInfo(v);
  const extra =
    v === RoundVerdict.TIE_REMATCH
      ? t("verdictPanel.tieConfirmExtra")
      : v === RoundVerdict.A_DISCONNECT_LOSS || v === RoundVerdict.B_DISCONNECT_LOSS
        ? t("verdictPanel.dcConfirmExtra")
        : "";
  try {
    await ElMessageBox.confirm(`${extra}${t("verdictPanel.confirmMsg", { label: info.label })}`, t("verdictPanel.confirmTitle"), {
      type: "warning",
      confirmButtonText: t("verdictPanel.confirmBtn"),
      cancelButtonText: t("common.cancel"),
    });
  } catch {
    return;
  }
  match.doVerdict(v);
}

async function onTerminate(): Promise<void> {
  try {
    const res = await ElMessageBox.prompt(t("verdictPanel.terminatePromptMsg"), t("verdictPanel.terminateTitle"), {
      type: "error",
      confirmButtonText: t("verdictPanel.terminateBtn"),
      cancelButtonText: t("common.cancel"),
      inputPlaceholder: t("verdictPanel.terminatePlaceholder"),
      inputValidator: (v) => (v && v.trim() ? true : t("verdictPanel.reasonRequired")),
    });
    match.terminateRound(res.value.trim());
  } catch {
    // 取消
  }
}
</script>

<template>
  <section class="panel">
    <div class="panel-title">{{ $t('verdictPanel.title') }}</div>

    <div v-if="match.currentPick" class="current">
      <span class="lab">{{ $t('verdictPanel.currentItem') }}</span>
      <b>{{ match.currentPick.code }}</b>
      <span v-if="match.currentPick.name"> · {{ match.currentPick.name }}</span>
      <span v-if="pickType" class="ptype">{{ pickType }}</span>
    </div>

    <div v-if="isJudging" class="block">
      <div class="row-label">{{ $t('verdictPanel.judgeRound') }}</div>
      <div class="verdict-row">
        <el-button
          v-for="vd in verdicts"
          :key="vd.v"
          :type="
            vd.kind === 'a'
              ? ('primary' as const)
              : vd.kind === 'b'
                ? ('danger' as const)
                : ('warning' as const)
          "
          size="large"
          @click="onVerdict(vd.v)"
        >
          {{ vd.label }}
        </el-button>
      </div>
      <div class="verdict-row disconnect">
        <span class="row-label">{{ $t('verdictPanel.exceptionHandling') }}</span>
        <el-button
          v-for="v in disconnectVerdicts"
          :key="v"
          size="default"
          plain
          @click="onVerdict(v)"
        >
          {{ disconnectLabel(v) }}
        </el-button>
      </div>
      <p class="tip">{{ $t('verdictPanel.postEditTip') }}</p>
    </div>

    <div v-if="isJudging || isInRound" class="block">
      <el-button type="danger" plain @click="onTerminate">{{ $t('verdictPanel.terminateUiBtn') }}</el-button>
    </div>

    <div v-if="!isJudging && !isInRound && match.currentPick" class="tip">
      {{ $t('verdictPanel.roundInProgressTip') }}
    </div>
  </section>
</template>

<style scoped>
.panel {
  background: var(--tc-bg-soft);
  border: 1px solid var(--tc-border);
  border-radius: 10px;
  padding: 14px 16px;
  margin-bottom: 12px;
}
.panel-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--tc-text-dim);
  margin-bottom: 10px;
  letter-spacing: 1px;
}
.current {
  font-size: 14px;
  margin-bottom: 12px;
  padding: 8px 10px;
  background: var(--tc-hover);
  border-radius: 8px;
}
.current .lab {
  color: var(--tc-text-dim);
}
.ptype {
  margin-left: 8px;
  color: var(--tc-primary);
  font-size: 12px;
}
.block {
  margin-bottom: 12px;
}
.row-label {
  font-size: 12px;
  color: var(--tc-text-dim);
  margin-bottom: 6px;
}
.verdict-row {
  display: flex;
  gap: 10px;
  margin-bottom: 10px;
}
.verdict-row.disconnect {
  align-items: center;
}
.tip {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--tc-text-dim);
}
</style>

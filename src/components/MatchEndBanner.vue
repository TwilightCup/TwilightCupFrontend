<script setup lang="ts">
import { computed } from "vue";
import { ElMessageBox } from "element-plus";
import { useI18n } from "vue-i18n";
import { useMatchStore } from "@/stores/match";

const { t } = useI18n();
const match = useMatchStore();

/** 胜方用户名（decidedWinner 为 "A"/"B"，按比分自动判定） */
const winnerName = computed(
  () =>
    (match.decidedWinner && match.playerNames[match.decidedWinner]) ||
    match.decidedWinner ||
    "",
);

async function onEnd(): Promise<void> {
  try {
    await ElMessageBox.confirm(
      t("matchEndBanner.confirmMsg", { name: winnerName.value }),
      t("matchEndBanner.confirmTitle"),
      {
        type: "warning",
        confirmButtonText: t("matchEndBanner.endBtn"),
        cancelButtonText: t("common.cancel"),
      },
    );
  } catch {
    return;
  }
  match.endMatch();
}
</script>

<template>
  <section v-if="match.decidedWinner" class="panel end-banner">
    <div class="info">
      <span class="trophy">🏆</span>
      <div>
        <div class="title">{{ $t('matchEndBanner.title') }}</div>
        <div class="winner">
          {{ $t('matchEndBanner.winnerLabel', { name: winnerName }) }}
        </div>
      </div>
    </div>
    <el-button type="danger" size="large" @click="onEnd">
      {{ $t('matchEndBanner.endBtn') }}
    </el-button>
  </section>
</template>

<style scoped>
.end-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-color: var(--tc-primary);
}
.info {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.trophy {
  font-size: 30px;
}
.title {
  font-size: 12px;
  font-weight: 600;
  color: var(--tc-text-dim);
  letter-spacing: 1px;
}
.winner {
  font-size: 18px;
  font-weight: 700;
  color: var(--tc-primary);
}
</style>

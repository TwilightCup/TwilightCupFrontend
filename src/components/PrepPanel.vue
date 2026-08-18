<script setup lang="ts">
import { ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useI18n } from "vue-i18n";
import { useMatchStore } from "@/stores/match";
import { MatchPhase } from "@/api/types";
import { useCtTagSelect } from "@/composables/useCtTagSelect";

const { t } = useI18n();

const match = useMatchStore();
const ctTags = useCtTagSelect();

const pickInput = ref<string>(match.pendingPickCode ?? "");
const retryInput = ref<number | null>(match.pendingRetry);

watch(
  () => match.pendingPickCode,
  (v) => {
    pickInput.value = v ?? pickInput.value;
  },
);
// 进入准备阶段时以已提交重试为初值（平局重赛沿用服务端冻结值）
watch(
  () => [match.pendingPickCode, match.phase] as const,
  ([, ph]) => {
    if (ph === MatchPhase.PREP) retryInput.value = match.pendingRetry;
  },
  { immediate: true },
);

function applyPick(): void {
  const code = (pickInput.value ?? "").trim();
  if (!code) {
    ElMessage.warning(t("prep.pickRequired"));
    return;
  }
  // CT/EX 选图连同词条一起提交；CP 自动 Checkpoint；非词条类别不带 tags
  // CT/EX 单关重试次数必填（composable 内按类别判断）
  if (ctTags.needsRetry.value && (retryInput.value == null || retryInput.value < 1)) {
    ElMessage.warning(t("banpick.pickRetryRequired"));
    return;
  }
  match.selectPick(code, ctTags.prepareSubmit(code), ctTags.needsRetry.value ? (retryInput.value ?? 1) : undefined);
}

async function confirmManualStart(): Promise<void> {
  if (!match.pendingPickCode) {
    ElMessage.warning(t("prep.pickBeforeManual"));
    return;
  }
  try {
    await ElMessageBox.confirm(
      t("prep.manualConfirmMsg"),
      t("prep.manualConfirmTitle"),
      { type: "warning", confirmButtonText: t("prep.manualConfirmBtn"), cancelButtonText: t("common.cancel") },
    );
  } catch {
    return;
  }
  match.manualStart();
}

const isPrep = () => match.phase === MatchPhase.PREP;
</script>

<template>
  <section class="panel">
    <div class="panel-title">{{ $t('prep.title') }}</div>

    <div v-if="match.canMarkPrep" class="block">
      <el-button type="primary" size="large" @click="match.markPrep()">
        {{ $t('prep.markBtn') }}
      </el-button>
      <p class="tip">{{ $t('prep.markTip') }}</p>
    </div>

    <template v-if="isPrep()">
      <div class="block">
        <div class="row-label">{{ $t('prep.pickLabel') }}</div>
        <div class="pick-row">
          <el-select
            v-model="pickInput"
            filterable
            allow-create
            default-first-option
            :placeholder="$t('prep.pickPlaceholder')"
            class="pick-select"
            @change="applyPick"
          >
            <el-option
              v-for="p in match.pickList"
              :key="p.code"
              :value="p.code"
              :label="p.name ? `${p.code} · ${p.name}` : p.code"
            />
          </el-select>
          <el-button type="primary" @click="applyPick">{{ $t('prep.applyPickBtn') }}</el-button>
        </div>
        <div v-if="ctTags.isCtPick || ctTags.isCpPick.value" class="tag-block">
          <div class="row-label">
            {{
              ctTags.isCpPick.value
                ? $t('banpick.prepCpTagLabel')
                : $t('prep.ctTagLabel', { n: ctTags.tagLimit.value })
            }}
          </div>
          <el-select
            v-if="!ctTags.isCpPick.value"
            v-model="ctTags.tagInput.value"
            multiple
            collapse-tags
            :multiple-limit="ctTags.tagLimit.value"
            :placeholder="$t('prep.ctTagPlaceholder')"
            class="pick-select"
          >
            <el-option
              v-for="o in ctTags.tagOptions.value"
              :key="o.value"
              :value="o.value"
              :label="o.value"
              :disabled="o.disabled"
            />
          </el-select>
          <el-tag v-else type="warning" effect="plain">Checkpoint</el-tag>
          <el-input-number
            v-if="ctTags.needsRetry.value"
            v-model="retryInput"
            :min="1"
            controls-position="right"
            class="retry-input"
          />
          <p class="tip">{{ $t('prep.ctTagTip', { n: ctTags.tagLimit.value }) }}</p>
          <p v-if="ctTags.bannedHit.value.length > 0" class="tip warn">
            {{ $t('prep.ctTagBannedHit', { tags: ctTags.bannedHit.value.join(', ') }) }}
          </p>
        </div>
        <div v-if="match.pendingPickCode" class="picked">
          {{ $t('prep.pickSelected', { code: match.pendingPickCode }) }}
          <span v-if="match.pickInfo[match.pendingPickCode]?.name">
            · {{ match.pickInfo[match.pendingPickCode]?.name }}</span
          >
          <template v-if="match.pendingTags.length > 0">
            <el-tag
              v-for="tg in match.pendingTags"
              :key="tg"
              size="small"
              type="warning"
              effect="plain"
              class="picked-tag"
            >{{ tg }}</el-tag>
          </template>
        </div>
        <div v-else class="picked dim">{{ $t('prep.pickNotSelected') }}</div>
      </div>

      <div class="block">
        <div class="row-label">{{ $t('prep.readyStatus') }}</div>
        <div class="ready-row">
          <div class="ready a" :class="{ on: match.aReady }">
            <span class="who">{{ match.playerNames.A || $t('seat.a') }}</span>
            <el-tag :type="match.aReady ? ('success' as const) : ('info' as const)" effect="dark">
              {{ match.aReady ? $t('playerStatus.ready') : $t('playerStatus.notReady') }}
            </el-tag>
          </div>
          <div class="ready b" :class="{ on: match.bReady }">
            <span class="who">{{ match.playerNames.B || $t('seat.b') }}</span>
            <el-tag :type="match.bReady ? ('success' as const) : ('info' as const)" effect="dark">
              {{ match.bReady ? $t('playerStatus.ready') : $t('playerStatus.notReady') }}
            </el-tag>
          </div>
        </div>
        <p class="tip">
          {{ $t('prep.autoTip') }}
        </p>
      </div>

      <div class="block">
        <el-button type="warning" size="large" @click="confirmManualStart">
          {{ $t('prep.manualStartBtn') }}
        </el-button>
      </div>
    </template>
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
  margin-bottom: 12px;
  letter-spacing: 1px;
}
.block {
  margin-bottom: 14px;
}
.block:last-child {
  margin-bottom: 0;
}
.row-label {
  font-size: 12px;
  color: var(--tc-text-dim);
  margin-bottom: 6px;
}
.pick-row {
  display: flex;
  gap: 8px;
}
.pick-select {
  flex: 1;
}
.picked {
  margin-top: 6px;
  font-size: 13px;
}
.picked.dim {
  color: var(--tc-text-dim);
}
.tag-block {
  margin-top: 8px;
}
.retry-input {
  width: 130px;
  flex-shrink: 0;
}
.picked-tag {
  margin-left: 6px;
}
.tip.warn {
  color: #ffb84d;
}
.ready-row {
  display: flex;
  gap: 12px;
}
.ready {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
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
.ready.a .who {
  color: var(--tc-a);
}
.ready.b .who {
  color: var(--tc-b);
}
.tip {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--tc-text-dim);
}
.tip code {
  background: var(--tc-bg);
  padding: 1px 5px;
  border-radius: 4px;
}
</style>

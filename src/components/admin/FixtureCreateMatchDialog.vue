<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import type { FormInstance, FormRules } from "element-plus";
import { ElMessage } from "element-plus";
import { useI18n } from "vue-i18n";
import { useAdminStore } from "@/stores/admin";
import {
  ScoringMethod,
  type FixtureOut,
  type TournamentOut,
} from "@/api/types";
import { categoryKindInfo } from "@/utils/format";
import { categoryKindOf } from "@/utils/mappool";

/**
 * 为对阵生成实战比赛：单场规则（BO/取胜分/计分/延迟/ban/protect/图池）在此指定。
 * 赛事不再持有这些字段，每次开局填一份。提交 → createMatchForFixture。
 */
const props = defineProps<{
  modelValue: boolean;
  fixture: FixtureOut | null;
  tournament: TournamentOut;
}>();
const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void;
  (e: "done"): void;
}>();

const { t } = useI18n();
const admin = useAdminStore();
const router = useRouter();
const formRef = ref<FormInstance>();
const submitting = ref(false);

const scoringOptions = computed(() => [
  { value: ScoringMethod.FASTEST, label: t("scoring.fastestFull") },
  { value: ScoringMethod.AVERAGE, label: t("scoring.averageFull") },
]);

const form = reactive({
  bo_format: 9,
  win_threshold: null as number | null,
  scoring_method: ScoringMethod.FASTEST as ScoringMethod,
  start_countdown_delay: 5,
  ban_count: 1,
  protect_count: 1,
  ct_tag_count: 2,
  mappool_id: "",
});

function reset(): void {
  form.bo_format = 9;
  form.win_threshold = null;
  form.scoring_method = ScoringMethod.FASTEST;
  form.start_countdown_delay = 5;
  form.ban_count = 1;
  form.protect_count = 1;
  form.ct_tag_count = 2;
  form.mappool_id = "";
}

const selectedMappool = computed(
  () => admin.mappools.find((m) => m.id === form.mappool_id) ?? null,
);

const rules: FormRules = {
  bo_format: [{ required: true, message: t("fixtureMatch.boFormatRequired"), trigger: "blur" }],
};

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    admin.loadMappools();
    reset();
    formRef.value?.clearValidate();
  },
);

function close(): void {
  emit("update:modelValue", false);
}

function playerLabel(id: string | null): string {
  return id ? admin.displayName(id) : t("common.dash");
}

async function onSubmit(): Promise<void> {
  if (!formRef.value) return;
  try {
    await formRef.value.validate();
  } catch {
    return;
  }
  if (!form.mappool_id) {
    ElMessage.warning(t("fixtureMatch.selectMappoolWarn"));
    return;
  }
  if (form.win_threshold !== null && form.win_threshold > form.bo_format) {
    ElMessage.warning(t("fixtureMatch.winThresholdExceedsBoWarn"));
    return;
  }
  submitting.value = true;
  const body = {
    bo_format: form.bo_format,
    scoring_method: form.scoring_method,
    start_countdown_delay: form.start_countdown_delay,
    ban_count: form.ban_count,
    protect_count: form.protect_count,
    ct_tag_count: form.ct_tag_count,
    mappool_id: form.mappool_id,
    ...(form.win_threshold && form.win_threshold > 0
      ? { win_threshold: form.win_threshold }
      : {}),
  };
  const m = await admin.createMatchForFixture(
    props.tournament.id,
    props.fixture!.id,
    body,
  );
  submitting.value = false;
  if (m) {
    emit("done");
    close();
  }
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="$t('fixtureMatch.title')"
    width="720px"
    :close-on-click-modal="false"
    top="6vh"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div v-if="fixture" class="fixture-summary">
      <span class="dim">{{ $t('fixtureMatch.summaryPrefix') }}</span>
      <span class="pa">{{ playerLabel(fixture.player_a_id) }}</span>
      <span class="sep">vs</span>
      <span class="pb">{{ playerLabel(fixture.player_b_id) }}</span>
    </div>

    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-width="100px"
      label-position="right"
    >
      <div class="row">
        <el-form-item :label="$t('fixtureMatch.labelBoFormat')" prop="bo_format" class="col">
          <el-input-number
            v-model="form.bo_format"
            :min="1"
            :step="2"
            controls-position="right"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item :label="$t('fixtureMatch.labelWinThreshold')" class="col">
          <el-input-number
            v-model="form.win_threshold"
            :min="1"
            controls-position="right"
            :placeholder="$t('fixtureMatch.winThresholdPlaceholder')"
            style="width: 100%"
          />
          <div class="field-hint">{{ $t('fixtureMatch.winThresholdHint') }}</div>
        </el-form-item>
      </div>

      <div class="row">
        <el-form-item :label="$t('fixtureMatch.labelScoringMethod')" class="col">
          <el-select v-model="form.scoring_method" style="width: 100%">
            <el-option
              v-for="o in scoringOptions"
              :key="o.value"
              :value="o.value"
              :label="o.label"
            />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('fixtureMatch.labelStartDelay')" class="col">
          <el-input-number
            v-model="form.start_countdown_delay"
            :min="0"
            controls-position="right"
            style="width: 100%"
          />
        </el-form-item>
      </div>

      <div class="row">
        <el-form-item :label="$t('fixtureMatch.labelBanCount')" class="col">
          <el-input-number
            v-model="form.ban_count"
            :min="0"
            controls-position="right"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item :label="$t('fixtureMatch.labelProtectCount')" class="col">
          <el-input-number
            v-model="form.protect_count"
            :min="0"
            controls-position="right"
            style="width: 100%"
          />
        </el-form-item>
      </div>

      <div class="row">
        <el-form-item :label="$t('fixtureMatch.labelCtTagCount')" class="col">
          <el-input-number
            v-model="form.ct_tag_count"
            :min="0"
            :max="4"
            controls-position="right"
            style="width: 100%"
          />
          <div class="field-hint">{{ $t('fixtureMatch.ctTagCountHint') }}</div>
        </el-form-item>
      </div>

      <el-form-item :label="$t('fixtureMatch.labelMappool')" required>
        <div class="mappool-wrap">
          <div v-if="admin.mappools.length === 0" class="empty-mp">
            <span>{{ $t('fixtureMatch.mappoolEmpty') }}</span>
            <el-button
              size="small"
              type="primary"
              plain
              @click="router.push('/admin/mappools')"
            >
              {{ $t('fixtureMatch.goCreateMappoolBtn') }}
            </el-button>
          </div>
          <el-select
            v-else
            v-model="form.mappool_id"
            filterable
            :placeholder="$t('fixtureMatch.mappoolPlaceholder')"
            style="width: 100%"
          >
            <el-option
              v-for="m in admin.mappools"
              :key="m.id"
              :value="m.id"
              :label="`${m.name}（${$t('common.picksCount', { n: m.mappool.categories.reduce((n, c) => n + c.picks.length, 0) })}）`"
            />
          </el-select>

          <div v-if="selectedMappool" class="mp-preview">
            <span class="dim">{{ $t('fixtureMatch.mappoolPreview') }}</span>
            <span
              v-for="c in selectedMappool.mappool.categories"
              :key="c.name"
              class="mp-cat"
            >
              <el-tag
                v-if="categoryKindOf(c.name)"
                size="small"
                :type="categoryKindInfo(c.name)!.type"
                effect="dark"
              >
                {{ categoryKindInfo(c.name)!.short }}
              </el-tag>
              <span class="mp-codes">
                {{ c.picks.map((p) => p.code).join(" / ") || $t('common.empty') }}
              </span>
            </span>
          </div>
        </div>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="close">{{ $t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="submitting" @click="onSubmit">
        {{ $t('fixtureMatch.submitBtn') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.fixture-summary {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  font-size: 14px;
}
.fixture-summary .pa {
  color: var(--el-color-primary);
  font-weight: 600;
}
.fixture-summary .pb {
  color: var(--el-color-danger);
  font-weight: 600;
}
.fixture-summary .sep {
  color: var(--tc-text-dim);
  font-size: 12px;
}
.fixture-summary .dim {
  font-size: 12px;
  color: var(--tc-text-dim);
}
.row {
  display: flex;
  gap: 16px;
}
.col {
  flex: 1;
}
.mappool-wrap {
  width: 100%;
}
.empty-mp {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  color: var(--tc-text-dim);
}
.mp-preview {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}
.mp-preview .dim {
  font-size: 12px;
  width: 100%;
}
.mp-cat {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.mp-codes {
  font-size: 12px;
  color: var(--tc-text-dim);
}
.field-hint {
  font-size: 12px;
  color: var(--tc-text-dim);
  margin-top: 4px;
  line-height: 1.4;
}
</style>

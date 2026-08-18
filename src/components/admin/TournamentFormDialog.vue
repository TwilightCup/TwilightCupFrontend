<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import type { FormInstance, FormRules } from "element-plus";
import { useI18n } from "vue-i18n";
import { useAdminStore } from "@/stores/admin";
import {
  TournamentFormat,
  type TournamentCreate,
  type TournamentOut,
  type TournamentUpdate,
} from "@/api/types";

/**
 * 赛事 创建/编辑 弹窗（赛事=编排容器：赛制 + 瑞士轮积分）。
 * 单场规则（BO/图池/ban/protect 等）不再属于赛事，改在为对阵生成比赛时指定。
 * - 编辑：仅 DRAFT 状态；format 不可改（disabled）。
 * - 瑞士轮积分字段仅在赛制=SWISS 时显示。
 */
const props = defineProps<{
  modelValue: boolean;
  tournament?: TournamentOut | null;
}>();
const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void;
  (e: "done"): void;
}>();

const { t } = useI18n();
const admin = useAdminStore();
const formRef = ref<FormInstance>();
const submitting = ref(false);

const isEdit = computed(() => !!props.tournament);

const formatOptions = computed<{ value: TournamentFormat; label: string }[]>(() => [
  { value: TournamentFormat.SINGLE_ELIM, label: t("tourneyFormat.singleElim") },
  { value: TournamentFormat.DOUBLE_ELIM, label: t("tourneyFormat.doubleElim") },
  { value: TournamentFormat.SWISS, label: t("tourneyFormat.swiss") },
]);

const form = reactive({
  name: "",
  format: TournamentFormat.SINGLE_ELIM as TournamentFormat,
  swiss_rounds: null as number | null,
  swiss_win_points: 1,
  swiss_loss_points: 0,
  swiss_draw_points: 0,
});

function reset(): void {
  form.name = "";
  form.format = TournamentFormat.SINGLE_ELIM;
  form.swiss_rounds = null;
  form.swiss_win_points = 1;
  form.swiss_loss_points = 0;
  form.swiss_draw_points = 0;
}

const isSwiss = computed(() => form.format === TournamentFormat.SWISS);

const rules: FormRules = {
  name: [{ required: true, message: t("tourneyForm.nameRequired"), trigger: "blur" }],
};

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return;
    if (props.tournament) {
      const t = props.tournament;
      form.name = t.name;
      form.format = t.format;
      form.swiss_rounds = t.swiss_rounds;
      form.swiss_win_points = t.swiss_win_points;
      form.swiss_loss_points = t.swiss_loss_points;
      form.swiss_draw_points = t.swiss_draw_points;
    } else {
      reset();
    }
    formRef.value?.clearValidate();
  },
);

function close(): void {
  emit("update:modelValue", false);
}

async function onSubmit(): Promise<void> {
  if (!formRef.value) return;
  try {
    await formRef.value.validate();
  } catch {
    return;
  }
  submitting.value = true;
  let ok: TournamentOut | null = null;
  const swissFields =
    isSwiss.value
      ? {
          swiss_win_points: form.swiss_win_points,
          swiss_loss_points: form.swiss_loss_points,
          swiss_draw_points: form.swiss_draw_points,
          ...(form.swiss_rounds && form.swiss_rounds > 0
            ? { swiss_rounds: form.swiss_rounds }
            : {}),
        }
      : {};
  if (isEdit.value) {
    const body: TournamentUpdate = {
      name: form.name.trim(),
      ...swissFields,
    };
    ok = await admin.updateTournament(props.tournament!.id, body);
  } else {
    const body: TournamentCreate = {
      name: form.name.trim(),
      format: form.format,
      ...swissFields,
    };
    ok = await admin.createTournament(body);
  }
  submitting.value = false;
  if (ok) {
    emit("done");
    close();
  }
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="isEdit ? $t('tourneyForm.titleEdit') : $t('tourneyForm.titleCreate')"
    width="560px"
    :close-on-click-modal="false"
    top="8vh"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-width="100px"
      label-position="right"
    >
      <el-form-item :label="$t('tourneyForm.labelName')" prop="name">
        <el-input v-model="form.name" :placeholder="$t('tourneyForm.namePlaceholder')" />
      </el-form-item>

      <el-form-item :label="$t('tourneyForm.labelFormat')">
        <el-radio-group v-model="form.format" :disabled="isEdit">
          <el-radio
            v-for="o in formatOptions"
            :key="o.value"
            :value="o.value"
          >
            {{ o.label }}
          </el-radio>
        </el-radio-group>
        <div class="field-hint">
          {{ $t('tourneyForm.formatHint') }}
        </div>
      </el-form-item>

      <template v-if="isSwiss">
        <div class="row">
          <el-form-item :label="$t('tourneyForm.labelSwissRounds')" class="col">
            <el-input-number
              v-model="form.swiss_rounds"
              :min="1"
              controls-position="right"
              :placeholder="$t('tourneyForm.swissRoundsPlaceholder')"
              style="width: 100%"
            />
            <div class="field-hint">{{ $t('tourneyForm.swissRoundsHint') }}</div>
          </el-form-item>
          <el-form-item :label="$t('tourneyForm.labelWinPoints')" class="col">
            <el-input-number
              v-model="form.swiss_win_points"
              :min="0"
              controls-position="right"
              style="width: 100%"
            />
          </el-form-item>
        </div>
        <div class="row">
          <el-form-item :label="$t('tourneyForm.labelLossPoints')" class="col">
            <el-input-number
              v-model="form.swiss_loss_points"
              :min="0"
              controls-position="right"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item :label="$t('tourneyForm.labelDrawPoints')" class="col">
            <el-input-number
              v-model="form.swiss_draw_points"
              :min="0"
              controls-position="right"
              style="width: 100%"
            />
          </el-form-item>
        </div>
      </template>
    </el-form>

    <template #footer>
      <el-button @click="close">{{ $t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="submitting" @click="onSubmit">
        {{ isEdit ? $t('tourneyForm.saveEditBtn') : $t('tourneyForm.createBtn') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.row {
  display: flex;
  gap: 16px;
}
.col {
  flex: 1;
}
.field-hint {
  font-size: 12px;
  color: var(--tc-text-dim);
  margin-top: 4px;
  line-height: 1.4;
}
</style>

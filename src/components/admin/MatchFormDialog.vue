<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import type { FormInstance, FormRules } from "element-plus";
import { ElMessage } from "element-plus";
import { useI18n } from "vue-i18n";
import { useAdminStore } from "@/stores/admin";
import { AccountType, ScoringMethod, type MatchCreate } from "@/api/types";
import { categoryKindInfo } from "@/utils/format";
import { categoryKindOf } from "@/utils/mappool";

const props = defineProps<{ modelValue: boolean }>();
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
  name: "",
  bo_format: 3,
  win_threshold: null as number | null,
  scoring_method: ScoringMethod.FASTEST as ScoringMethod,
  start_countdown_delay: 5,
  ban_count: 1,
  protect_count: 1,
  ct_tag_count: 2,
  mappool_id: "" as string,
  player_a: "",
  player_b: "",
  referee: "",
  director: "",
});

function reset(): void {
  form.name = "";
  form.bo_format = 3;
  form.win_threshold = null;
  form.scoring_method = ScoringMethod.FASTEST;
  form.start_countdown_delay = 5;
  form.ban_count = 1;
  form.protect_count = 1;
  form.ct_tag_count = 2;
  form.mappool_id = "";
  form.player_a = "";
  form.player_b = "";
  form.referee = "";
  form.director = "";
}

/** 选手选项：附带 busyIn（所在 RUNNING 比赛名）用于占用提示；暂停(PAUSED)比赛的选手不占用。 */
const playerOptions = computed(() =>
  admin.accounts
    .filter((a) => a.roles.includes(AccountType.PLAYER))
    .map((a) => ({ ...a, busyIn: admin.playerBusyMap.get(a.id) ?? null })),
);
const refereeOptions = computed(() =>
  admin.accounts.filter((a) => a.roles.includes(AccountType.REFEREE)),
);
const directorOptions = computed(() =>
  admin.accounts.filter((a) => a.roles.includes(AccountType.DIRECTOR)),
);

const selectedMappool = computed(() =>
  admin.mappools.find((m) => m.id === form.mappool_id) ?? null,
);

const rules: FormRules = {
  name: [{ required: true, message: t("matchForm.nameRequired"), trigger: "blur" }],
  bo_format: [{ required: true, message: t("matchForm.boFormatRequired"), trigger: "blur" }],
  player_a: [{ required: true, message: t("matchForm.playerARequired"), trigger: "change" }],
  player_b: [{ required: true, message: t("matchForm.playerBRequired"), trigger: "change" }],
  referee: [{ required: true, message: t("matchForm.refereeRequired"), trigger: "change" }],
  director: [{ required: true, message: t("matchForm.directorRequired"), trigger: "change" }],
};

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      reset();
      admin.loadAccounts();
      admin.loadMappools();
      admin.loadMatches();
      formRef.value?.clearValidate();
    }
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
  if (form.player_a && form.player_a === form.player_b) {
    ElMessage.warning(t("matchForm.samePlayerWarn"));
    return;
  }
  if (!form.mappool_id) {
    ElMessage.warning(t("matchForm.selectMappoolWarn"));
    return;
  }
  const body: MatchCreate = {
    name: form.name.trim(),
    bo_format: form.bo_format,
    scoring_method: form.scoring_method,
    start_countdown_delay: form.start_countdown_delay,
    ban_count: form.ban_count,
    protect_count: form.protect_count,
    ct_tag_count: form.ct_tag_count,
    mappool_id: form.mappool_id,
    player_a: form.player_a,
    player_b: form.player_b,
    referee: form.referee,
    director: form.director,
  };
  if (form.win_threshold && form.win_threshold > 0) {
    body.win_threshold = form.win_threshold;
  }
  submitting.value = true;
  const s = await admin.createMatch(body);
  submitting.value = false;
  if (s) {
    emit("done");
    close();
  }
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="$t('matchForm.title')"
    width="720px"
    :close-on-click-modal="false"
    top="6vh"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <el-form
      ref="formRef"
      :model="form"
      :rules="rules"
      label-width="100px"
      label-position="right"
    >
      <el-form-item :label="$t('matchForm.labelName')" prop="name">
        <el-input v-model="form.name" :placeholder="$t('matchForm.namePlaceholder')" />
      </el-form-item>

      <div class="row">
        <el-form-item :label="$t('matchForm.labelBoFormat')" prop="bo_format" class="col">
          <el-input-number
            v-model="form.bo_format"
            :min="1"
            :step="2"
            controls-position="right"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item :label="$t('matchForm.labelWinThreshold')" class="col">
          <el-input-number
            v-model="form.win_threshold"
            :min="1"
            controls-position="right"
            :placeholder="$t('matchForm.winThresholdPlaceholder')"
            style="width: 100%"
          />
          <div class="field-hint">{{ $t('matchForm.winThresholdHint') }}</div>
        </el-form-item>
      </div>

      <div class="row">
        <el-form-item :label="$t('matchForm.labelScoringMethod')" class="col">
          <el-select v-model="form.scoring_method" style="width: 100%">
            <el-option
              v-for="o in scoringOptions"
              :key="o.value"
              :value="o.value"
              :label="o.label"
            />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('matchForm.labelStartDelay')" class="col">
          <el-input-number
            v-model="form.start_countdown_delay"
            :min="0"
            controls-position="right"
            style="width: 100%"
          />
        </el-form-item>
      </div>

      <div class="row">
        <el-form-item :label="$t('matchForm.labelBanCount')" class="col">
          <el-input-number
            v-model="form.ban_count"
            :min="0"
            controls-position="right"
            style="width: 100%"
          />
          <div class="field-hint">{{ $t('matchForm.banCountHint') }}</div>
        </el-form-item>
        <el-form-item :label="$t('matchForm.labelProtectCount')" class="col">
          <el-input-number
            v-model="form.protect_count"
            :min="0"
            controls-position="right"
            style="width: 100%"
          />
          <div class="field-hint">{{ $t('matchForm.protectCountHint') }}</div>
        </el-form-item>
      </div>

      <div class="row">
        <el-form-item :label="$t('matchForm.labelCtTagCount')" class="col">
          <el-input-number
            v-model="form.ct_tag_count"
            :min="0"
            :max="4"
            controls-position="right"
            style="width: 100%"
          />
          <div class="field-hint">{{ $t('matchForm.ctTagCountHint') }}</div>
        </el-form-item>
      </div>

      <el-form-item :label="$t('matchForm.labelMappool')" required>
        <div class="mappool-wrap">
          <div v-if="admin.mappools.length === 0" class="empty-mp">
            <span>{{ $t('matchForm.mappoolEmpty') }}</span>
            <el-button size="small" type="primary" plain @click="router.push('/admin/mappools')">
              {{ $t('matchForm.goCreateMappoolBtn') }}
            </el-button>
          </div>
          <el-select
            v-else
            v-model="form.mappool_id"
            filterable
            :placeholder="$t('matchForm.mappoolPlaceholder')"
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
            <span class="dim">{{ $t('matchForm.mappoolPreview') }}</span>
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

      <div class="row">
        <el-form-item :label="$t('matchForm.labelPlayerA')" prop="player_a" class="col">
          <el-select
            v-model="form.player_a"
            filterable
            :placeholder="$t('matchForm.playerPlaceholder')"
            style="width: 100%"
          >
            <el-option
              v-for="a in playerOptions"
              :key="a.id"
              :value="a.username"
              :label="a.busyIn ? `${a.display_name}（${a.username}）${$t('matchForm.playerBusySuffix', { busyIn: a.busyIn })}` : `${a.display_name}（${a.username}）`"
              :disabled="!!a.busyIn"
            />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('matchForm.labelPlayerB')" prop="player_b" class="col">
          <el-select
            v-model="form.player_b"
            filterable
            :placeholder="$t('matchForm.playerPlaceholder')"
            style="width: 100%"
          >
            <el-option
              v-for="a in playerOptions"
              :key="a.id"
              :value="a.username"
              :label="a.busyIn ? `${a.display_name}（${a.username}）${$t('matchForm.playerBusySuffix', { busyIn: a.busyIn })}` : `${a.display_name}（${a.username}）`"
              :disabled="!!a.busyIn"
            />
          </el-select>
        </el-form-item>
      </div>

      <div class="row">
        <el-form-item :label="$t('matchForm.labelReferee')" prop="referee" class="col">
          <el-select
            v-model="form.referee"
            filterable
            :placeholder="$t('matchForm.refereePlaceholder')"
            style="width: 100%"
          >
            <el-option
              v-for="a in refereeOptions"
              :key="a.id"
              :value="a.username"
              :label="`${a.display_name}（${a.username}）`"
            />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('matchForm.labelDirector')" prop="director" class="col">
          <el-select
            v-model="form.director"
            filterable
            :placeholder="$t('matchForm.directorPlaceholder')"
            style="width: 100%"
          >
            <el-option
              v-for="a in directorOptions"
              :key="a.id"
              :value="a.username"
              :label="`${a.display_name}（${a.username}）`"
            />
          </el-select>
        </el-form-item>
      </div>
    </el-form>

    <template #footer>
      <el-button @click="close">{{ $t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="submitting" @click="onSubmit">
        {{ $t('matchForm.submitBtn') }}
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

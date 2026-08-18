<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useAdminStore } from "@/stores/admin";
import type { FixtureAssignBody, FixtureOut, TournamentOut } from "@/api/types";

/**
 * 为单个对阵指派裁判 / 导播。候选人限定在该赛事的裁判组 / 导播组内；
 * 留空表示不修改（后端无「取消指派」端点，故不能清空）。
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

// useI18n() 激活本组件作用域的 $t（模板中通过 $t('key') 取文案）
useI18n();
const admin = useAdminStore();
const submitting = ref(false);

const form = reactive<{ referee: string; director: string }>({
  referee: "",
  director: "",
});

const refereeOptions = computed(() =>
  props.tournament.referee_ids
    .map((id) => admin.accountById.get(id))
    .filter((a): a is NonNullable<typeof a> => !!a),
);
const directorOptions = computed(() =>
  props.tournament.director_ids
    .map((id) => admin.accountById.get(id))
    .filter((a): a is NonNullable<typeof a> => !!a),
);

function usernameOf(id: string | null): string {
  if (!id) return "";
  return admin.accountById.get(id)?.username ?? "";
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open || !props.fixture) return;
    form.referee = usernameOf(props.fixture.referee_id);
    form.director = usernameOf(props.fixture.director_id);
  },
);

function close(): void {
  emit("update:modelValue", false);
}

async function onSubmit(): Promise<void> {
  if (!props.fixture) return;
  const body: FixtureAssignBody = {};
  if (form.referee) body.referee = form.referee;
  if (form.director) body.director = form.director;
  if (!body.referee && !body.director) {
    close();
    return;
  }
  submitting.value = true;
  const f = await admin.assignOfficials(
    props.tournament.id,
    props.fixture.id,
    body,
  );
  submitting.value = false;
  if (f) {
    emit("done");
    close();
  }
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="$t('fixtureAssign.title')"
    width="460px"
    :close-on-click-modal="false"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <el-form v-if="fixture" :model="form" label-width="70px" label-position="right">
      <el-form-item :label="$t('fixtureAssign.labelReferee')">
        <el-select
          v-model="form.referee"
          filterable
          clearable
          :placeholder="$t('fixtureAssign.refereePlaceholder')"
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
      <el-form-item :label="$t('fixtureAssign.labelDirector')">
        <el-select
          v-model="form.director"
          filterable
          clearable
          :placeholder="$t('fixtureAssign.directorPlaceholder')"
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
      <div class="hint">{{ $t('fixtureAssign.hint') }}</div>
    </el-form>
    <template #footer>
      <el-button @click="close">{{ $t('common.cancel') }}</el-button>
      <el-button type="primary" :loading="submitting" @click="onSubmit">
        {{ $t('fixtureAssign.submitBtn') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.hint {
  font-size: 12px;
  color: var(--tc-text-dim);
  margin-top: 4px;
}
</style>

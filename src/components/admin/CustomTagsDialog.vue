<script setup lang="ts">
import { ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useI18n } from "vue-i18n";
import { useAdminStore } from "@/stores/admin";
import type { CustomTag } from "@/api/types";

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ (e: "update:modelValue", v: boolean): void }>();

const { t } = useI18n();
const admin = useAdminStore();
const name = ref("");

async function add(): Promise<void> {
  const n = name.value.trim();
  if (!n) {
    ElMessage.warning(t("customTags.nameRequired"));
    return;
  }
  const tag = await admin.createCustomTag({ name: n });
  if (tag) name.value = "";
}

async function remove(tag: CustomTag): Promise<void> {
  try {
    await ElMessageBox.confirm(
      t("customTags.deleteConfirmMsg", { name: tag.name }),
      t("customTags.deleteConfirmTitle"),
      { type: "warning", confirmButtonText: t("common.delete"), cancelButtonText: t("common.cancel") },
    );
  } catch {
    return;
  }
  await admin.deleteCustomTag(tag.id);
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) void admin.loadCustomTags();
  },
  { immediate: true },
);
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="$t('customTags.title')"
    width="520px"
    :close-on-click-modal="false"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="ct-tags-manage">
      <p class="hint">{{ $t('customTags.hint') }}</p>

      <div class="add-row">
        <el-input
          v-model="name"
          :placeholder="$t('customTags.namePlaceholder')"
          clearable
          @keyup.enter="add"
        />
        <el-button type="primary" :loading="admin.customTagsLoading" @click="add">
          {{ $t('customTags.addBtn') }}
        </el-button>
      </div>

      <div v-loading="admin.customTagsLoading" class="tag-list">
        <div v-if="admin.customTags.length === 0" class="empty">
          {{ $t('customTags.empty') }}
        </div>
        <div v-for="tag in admin.customTags" :key="tag.id" class="tag-row">
          <span class="tag-name">{{ tag.name }}</span>
          <el-button
            link
            type="danger"
            :aria-label="$t('common.delete')"
            @click="remove(tag)"
          >
            {{ $t('common.delete') }}
          </el-button>
        </div>
      </div>
    </div>
  </el-dialog>
</template>

<style scoped>
.ct-tags-manage {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.hint {
  margin: 0;
  font-size: 12px;
  color: var(--tc-text-dim);
}
.add-row {
  display: flex;
  gap: 8px;
}
.tag-list {
  min-height: 120px;
  max-height: 360px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.empty {
  padding: 20px 0;
  text-align: center;
  color: var(--tc-text-dim);
  font-size: 13px;
}
.tag-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--tc-border);
  border-radius: 8px;
  background: var(--tc-bg-soft);
}
.tag-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--tc-text);
}
</style>

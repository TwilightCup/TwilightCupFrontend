<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessageBox } from "element-plus";
import { useI18n } from "vue-i18n";
import { useAdminStore } from "@/stores/admin";
import type { Level } from "@/api/types";
import { dateTime } from "@/utils/format";
import LevelFormDialog from "@/components/admin/LevelFormDialog.vue";

const { t } = useI18n();
const admin = useAdminStore();

const dialogOpen = ref(false);
const editing = ref<Level | null>(null);

function openCreate(): void {
  editing.value = null;
  dialogOpen.value = true;
}

function openEdit(row: Level): void {
  editing.value = row;
  dialogOpen.value = true;
}

async function onRemove(row: Level): Promise<void> {
  try {
    await ElMessageBox.confirm(
      t("admin.levels.deleteConfirmMsg", { name: row.name }),
      t("admin.levels.deleteConfirmTitle"),
      { type: "warning", confirmButtonText: t("common.delete"), cancelButtonText: t("common.cancel") },
    );
  } catch {
    return;
  }
  await admin.deleteLevel(row.id);
}

onMounted(() => {
  admin.loadLevels();
});
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <div class="title-area">
        <h2 class="page-title">{{ $t('admin.levels.title') }}</h2>
        <span class="count">{{ $t('admin.levels.count', { n: admin.levels.length }) }}</span>
      </div>
      <div class="actions">
        <el-button :loading="admin.levelsLoading" @click="admin.loadLevels(true)">
          {{ $t('common.refresh') }}
        </el-button>
        <el-button type="primary" @click="openCreate">{{ $t('admin.levels.createBtn') }}</el-button>
      </div>
    </div>

    <p class="preset-hint">{{ $t('admin.levels.presetHint') }}</p>

    <el-table
      :data="admin.levels"
      v-loading="admin.levelsLoading"
      stripe
      :empty-text="$t('admin.levels.empty')"
    >
      <el-table-column :label="$t('admin.levels.colLogo')" width="100">
        <template #default="{ row }">
          <img v-if="row.logo_url" :src="row.logo_url" class="logo-thumb" :alt="row.name" />
          <span v-else class="dim">{{ $t('common.dash') }}</span>
        </template>
      </el-table-column>
      <el-table-column :label="$t('admin.levels.colName')" prop="name" min-width="140" />
      <el-table-column :label="$t('admin.levels.colDisplayName')" prop="display_name" min-width="140" />
      <el-table-column :label="$t('common.createdAt')" width="170">
        <template #default="{ row }">{{ dateTime(row.created_at) }}</template>
      </el-table-column>
      <el-table-column :label="$t('common.actions')" width="140" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">{{ $t('common.edit') }}</el-button>
          <el-button link type="danger" @click="onRemove(row)">{{ $t('common.delete') }}</el-button>
        </template>
      </el-table-column>
    </el-table>

    <LevelFormDialog v-model="dialogOpen" :level="editing" />
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.title-area {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.page-title {
  margin: 0;
  font-size: 17px;
}
.count {
  color: var(--tc-text-dim);
  font-size: 13px;
}
.actions {
  display: flex;
  gap: 8px;
}
.preset-hint {
  margin: 0;
  font-size: 12px;
  color: var(--tc-text-dim);
  line-height: 1.6;
}
.logo-thumb {
  width: 64px;
  height: 48px;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid var(--tc-border);
  background: #000;
  display: block;
}
.dim {
  color: var(--tc-text-dim);
}
</style>

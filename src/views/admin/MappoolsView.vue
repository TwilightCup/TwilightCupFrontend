<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessageBox } from "element-plus";
import { useI18n } from "vue-i18n";
import { useAdminStore } from "@/stores/admin";
import type { MappoolLibItem } from "@/api/types";
import { categoryKindInfo, dateTime } from "@/utils/format";
import { categoryKindOf } from "@/utils/mappool";
import MappoolFormDialog from "@/components/admin/MappoolFormDialog.vue";
import CustomTagsDialog from "@/components/admin/CustomTagsDialog.vue";

const { t } = useI18n();
const admin = useAdminStore();

const dialogOpen = ref(false);
const customTagsOpen = ref(false);
const editing = ref<MappoolLibItem | null>(null);

function openCreate(): void {
  editing.value = null;
  dialogOpen.value = true;
}

function openEdit(row: MappoolLibItem): void {
  editing.value = row;
  dialogOpen.value = true;
}

async function onRemove(row: MappoolLibItem): Promise<void> {
  try {
    await ElMessageBox.confirm(
      t("admin.mappools.deleteConfirmMsg", { name: row.name }),
      t("admin.mappools.deleteConfirmTitle"),
      { type: "warning", confirmButtonText: t("common.delete"), cancelButtonText: t("common.cancel") },
    );
  } catch {
    return;
  }
  await admin.deleteMappool(row.id);
}

function pickCount(m: MappoolLibItem): number {
  return m.mappool.categories.reduce((n, c) => n + c.picks.length, 0);
}

/** 类别简码列表（去重保序），如 [ML, IL, CP]。 */
function kindCodes(m: MappoolLibItem): string[] {
  const out: string[] = [];
  for (const c of m.mappool.categories) {
    const k = categoryKindOf(c.name);
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

onMounted(() => {
  admin.loadMappools();
});
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <div class="title-area">
        <h2 class="page-title">{{ $t('admin.mappools.title') }}</h2>
        <span class="count">{{ $t('admin.mappools.count', { n: admin.mappools.length }) }}</span>
      </div>
      <div class="actions">
        <el-button @click="customTagsOpen = true">{{ $t('admin.mappools.customTagsBtn') }}</el-button>
        <el-button :loading="admin.mappoolsLoading" @click="admin.loadMappools(true)">
          {{ $t('common.refresh') }}
        </el-button>
        <el-button type="primary" @click="openCreate">{{ $t('admin.mappools.createBtn') }}</el-button>
      </div>
    </div>

    <el-table
      :data="admin.mappools"
      v-loading="admin.mappoolsLoading"
      :empty-text="$t('admin.mappools.empty')"
      stripe
      class="mp-table"
    >
      <el-table-column prop="name" :label="$t('admin.mappools.colName')" min-width="180" />
      <el-table-column :label="$t('admin.mappools.colPickCount')" width="90">
        <template #default="{ row }">{{ pickCount(row) }}</template>
      </el-table-column>
      <el-table-column :label="$t('admin.mappools.colCategories')" min-width="220">
        <template #default="{ row }">
          <el-tag
            v-for="k in kindCodes(row)"
            :key="k"
            :type="categoryKindInfo(k)?.type ?? 'info'"
            effect="dark"
            size="small"
            style="margin-right: 4px"
          >
            {{ categoryKindInfo(k)?.short ?? k }}
          </el-tag>
        </template>
      </el-table-column>
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

    <MappoolFormDialog v-model="dialogOpen" :mappool="editing" />
    <CustomTagsDialog v-model="customTagsOpen" />
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
  min-height: 0;
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.title-area {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.page-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}
.count {
  color: var(--tc-text-dim);
  font-size: 12px;
}
.actions {
  display: flex;
  gap: 8px;
}
.mp-table {
  flex: 1;
  min-height: 0;
}
</style>

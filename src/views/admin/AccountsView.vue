<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { useI18n } from "vue-i18n";
import { useAdminStore } from "@/stores/admin";
import { useAuthStore } from "@/stores/auth";
import type { AccountOut } from "@/api/types";
import { accountTypeInfo, dateTime } from "@/utils/format";
import AccountFormDialog from "@/components/admin/AccountFormDialog.vue";

const admin = useAdminStore();
const auth = useAuthStore();
const { t } = useI18n();

const keyword = ref("");
const dialogOpen = ref(false);
const editing = ref<AccountOut | null>(null);

const filtered = computed<AccountOut[]>(() => {
  const kw = keyword.value.trim().toLowerCase();
  if (!kw) return admin.accounts;
  return admin.accounts.filter(
    (a) =>
      a.username.toLowerCase().includes(kw) ||
      a.display_name.toLowerCase().includes(kw),
  );
});

function openCreate(): void {
  editing.value = null;
  dialogOpen.value = true;
}

function openEdit(row: AccountOut): void {
  editing.value = row;
  dialogOpen.value = true;
}

async function onRemove(row: AccountOut): Promise<void> {
  if (row.id === auth.accountId) {
    ElMessage.warning(t("admin.accounts.cannotDeleteSelf"));
    return;
  }
  try {
    await ElMessageBox.confirm(
      t("admin.accounts.deleteConfirmMsg", { username: row.username, displayName: row.display_name }),
      t("admin.accounts.deleteConfirmTitle"),
      { type: "warning", confirmButtonText: t("common.delete"), cancelButtonText: t("common.cancel") },
    );
  } catch {
    return;
  }
  await admin.deleteAccount(row.id);
}

onMounted(() => {
  admin.loadAccounts();
});
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <div class="title-area">
        <h2 class="page-title">{{ $t('admin.accounts.title') }}</h2>
        <span class="count">{{ $t('admin.accounts.count', { n: admin.accounts.length }) }}</span>
      </div>
      <div class="actions">
        <el-input
          v-model="keyword"
          :placeholder="$t('admin.accounts.searchPlaceholder')"
          clearable
          style="width: 220px"
        />
        <el-button :loading="admin.accountsLoading" @click="admin.loadAccounts(true)">
          {{ $t('common.refresh') }}
        </el-button>
        <el-button type="primary" @click="openCreate">{{ $t('admin.accounts.createBtn') }}</el-button>
      </div>
    </div>

    <el-table
      :data="filtered"
      v-loading="admin.accountsLoading"
      :empty-text="$t('admin.accounts.empty')"
      stripe
      class="acct-table"
    >
      <el-table-column prop="username" :label="$t('admin.accounts.colUsername')" min-width="140" />
      <el-table-column prop="display_name" :label="$t('admin.accounts.colDisplayName')" min-width="140" />
      <el-table-column :label="$t('admin.accounts.colRoles')" min-width="180">
        <template #default="{ row }">
          <el-tag
            v-for="r in row.roles"
            :key="r"
            :type="accountTypeInfo(r).type"
            effect="dark"
            size="small"
            style="margin-right: 4px"
          >
            {{ accountTypeInfo(r).label }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="$t('common.createdAt')" width="170">
        <template #default="{ row }">{{ dateTime(row.created_at) }}</template>
      </el-table-column>
      <el-table-column :label="$t('common.actions')" width="160" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">{{ $t('common.edit') }}</el-button>
          <el-tooltip
            v-if="row.id === auth.accountId"
            :content="$t('admin.accounts.cannotDeleteSelfTooltip')"
            placement="top"
          >
            <el-button link type="info" disabled>{{ $t('common.delete') }}</el-button>
          </el-tooltip>
          <el-button v-else link type="danger" @click="onRemove(row)">{{ $t('common.delete') }}</el-button>
        </template>
      </el-table-column>
    </el-table>

    <AccountFormDialog v-model="dialogOpen" :account="editing" />
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
.acct-table {
  flex: 1;
  min-height: 0;
}
</style>

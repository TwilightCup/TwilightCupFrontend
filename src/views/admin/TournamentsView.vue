<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessageBox } from "element-plus";
import { useI18n } from "vue-i18n";
import { useAdminStore } from "@/stores/admin";
import { TournamentStatus, type TournamentOut } from "@/api/types";
import { dateTime, tournamentFormatLabel, tournamentStatusInfo } from "@/utils/format";
import TournamentFormDialog from "@/components/admin/TournamentFormDialog.vue";

const { t } = useI18n();
const admin = useAdminStore();
const router = useRouter();

const dialogOpen = ref(false);
const editing = ref<TournamentOut | null>(null);

function refresh(): void {
  admin.loadTournaments(true);
}

function openCreate(): void {
  editing.value = null;
  dialogOpen.value = true;
}

function openEdit(row: TournamentOut): void {
  editing.value = row;
  dialogOpen.value = true;
}

function goDetail(row: TournamentOut): void {
  router.push({ name: "admin-tournament-detail", params: { id: row.id } });
}

async function onRemove(row: TournamentOut): Promise<void> {
  try {
    await ElMessageBox.confirm(
      t("admin.tournaments.deleteConfirmMsg", { name: row.name }),
      t("admin.tournaments.deleteConfirmTitle"),
      { type: "warning", confirmButtonText: t("common.delete"), cancelButtonText: t("common.cancel") },
    );
  } catch {
    return;
  }
  await admin.deleteTournament(row.id);
}

onMounted(() => {
  admin.loadTournaments();
});
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <div class="title-area">
        <h2 class="page-title">{{ $t('admin.tournaments.title') }}</h2>
        <span class="count">{{ $t('admin.tournaments.count', { n: admin.tournaments.length }) }}</span>
      </div>
      <div class="actions">
        <el-button :loading="admin.tournamentsLoading" @click="refresh">
          {{ $t('common.refresh') }}
        </el-button>
        <el-button type="primary" @click="openCreate">{{ $t('admin.tournaments.createBtn') }}</el-button>
      </div>
    </div>

    <el-table
      :data="admin.tournaments"
      v-loading="admin.tournamentsLoading"
      :empty-text="$t('admin.tournaments.empty')"
      stripe
      class="t-table"
      @row-click="goDetail"
    >
      <el-table-column prop="name" :label="$t('admin.tournaments.colName')" min-width="180" />
      <el-table-column :label="$t('admin.tournaments.colFormat')" width="110">
        <template #default="{ row }">{{ tournamentFormatLabel(row.format) }}</template>
      </el-table-column>
      <el-table-column :label="$t('admin.tournaments.colStatus')" width="110">
        <template #default="{ row }">
          <el-tag :type="tournamentStatusInfo(row.status).type" effect="dark" size="small">
            {{ tournamentStatusInfo(row.status).label }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="$t('admin.tournaments.colPlayerCount')" width="90" align="center">
        <template #default="{ row }">{{ row.participant_ids.length }}</template>
      </el-table-column>
      <el-table-column :label="$t('common.createdAt')" width="170">
        <template #default="{ row }">{{ dateTime(row.created_at) }}</template>
      </el-table-column>
      <el-table-column :label="$t('common.actions')" width="200" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click.stop="goDetail(row)">{{ $t('admin.tournaments.enterBtn') }}</el-button>
          <el-button
            v-if="row.status === TournamentStatus.DRAFT"
            link
            type="primary"
            @click.stop="openEdit(row)"
          >
            {{ $t('common.edit') }}
          </el-button>
          <el-button
            v-if="row.status === TournamentStatus.DRAFT"
            link
            type="danger"
            @click.stop="onRemove(row)"
          >
            {{ $t('common.delete') }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <TournamentFormDialog v-model="dialogOpen" :tournament="editing" @done="refresh" />
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
.t-table {
  flex: 1;
  min-height: 0;
  cursor: pointer;
}
</style>

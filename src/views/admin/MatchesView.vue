<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessageBox } from "element-plus";
import { useI18n } from "vue-i18n";
import { useAdminStore } from "@/stores/admin";
import { MatchStatus, type MatchOut } from "@/api/types";
import { dateTime, scoringMethodLabel, matchStatusInfo } from "@/utils/format";
import MatchFormDialog from "@/components/admin/MatchFormDialog.vue";
import MatchDetailDrawer from "@/components/admin/MatchDetailDrawer.vue";

const { t } = useI18n();
const admin = useAdminStore();

const createOpen = ref(false);
const detailOpen = ref(false);
const current = ref<MatchOut | null>(null);

function openDetail(row: MatchOut): void {
  current.value = row;
  detailOpen.value = true;
}

/** 强制结束（CREATED/RUNNING → ENDED）；裁判弃赛/卡住时释放选手 */
async function onForceEnd(row: MatchOut): Promise<void> {
  try {
    await ElMessageBox.confirm(
      t("admin.matches.forceEndConfirmMsg", { name: row.name }),
      t("admin.matches.forceEndConfirmTitle"),
      { type: "warning", confirmButtonText: t("admin.matches.forceEndBtn"), cancelButtonText: t("common.cancel") },
    );
  } catch {
    return;
  }
  await admin.forceEndMatch(row.id);
}

onMounted(() => {
  admin.loadAccounts();
  admin.loadMatches();
});
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <div class="title-area">
        <h2 class="page-title">{{ $t('admin.matches.title') }}</h2>
        <span class="count">{{ $t('admin.matches.count', { n: admin.matches.length }) }}</span>
      </div>
      <div class="actions">
        <el-button :loading="admin.matchesLoading" @click="admin.loadMatches()">
          {{ $t('common.refresh') }}
        </el-button>
        <el-button type="primary" @click="createOpen = true">{{ $t('admin.matches.createBtn') }}</el-button>
      </div>
    </div>

    <el-table
      :data="admin.matches"
      v-loading="admin.matchesLoading"
      :empty-text="$t('admin.matches.empty')"
      stripe
      class="sess-table"
    >
      <el-table-column prop="name" :label="$t('admin.matches.colName')" min-width="160" />
      <el-table-column :label="$t('admin.matches.colFormat')" width="120">
        <template #default="{ row }">
          BO{{ row.bo_format }}
          <span class="dim">{{ $t('admin.matches.firstTo', { n: row.win_threshold }) }}</span>
        </template>
      </el-table-column>
      <el-table-column :label="$t('admin.matches.colScoring')" width="80">
        <template #default="{ row }">
          {{ scoringMethodLabel(row.scoring_method) }}
        </template>
      </el-table-column>
      <el-table-column :label="$t('admin.matches.colStatus')" width="90">
        <template #default="{ row }">
          <el-tag :type="matchStatusInfo(row.status).type" effect="dark" size="small">
            {{ matchStatusInfo(row.status).label }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="$t('admin.matches.colMatchup')" min-width="180">
        <template #default="{ row }">
          <span class="tc-a">{{ admin.displayName(row.player_a_id) }}</span>
          <span class="dim">{{ $t('admin.matches.vs') }}</span>
          <span class="tc-b">{{ admin.displayName(row.player_b_id) }}</span>
        </template>
      </el-table-column>
      <el-table-column :label="$t('admin.matches.colOfficials')" min-width="160">
        <template #default="{ row }">
          <div class="dim">{{ admin.displayName(row.referee_id) }}</div>
          <div class="dim">{{ admin.displayName(row.director_id) }}</div>
        </template>
      </el-table-column>
      <el-table-column :label="$t('common.createdAt')" width="150">
        <template #default="{ row }">{{ dateTime(row.created_at) }}</template>
      </el-table-column>
      <el-table-column :label="$t('common.actions')" width="150" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openDetail(row)">{{ $t('admin.matches.detailBtn') }}</el-button>
          <el-button
            v-if="row.status === MatchStatus.CREATED || row.status === MatchStatus.RUNNING"
            link
            type="danger"
            @click="onForceEnd(row)"
          >
            {{ $t('admin.matches.forceEndBtn') }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <MatchFormDialog v-model="createOpen" />
    <MatchDetailDrawer v-model="detailOpen" :match="current" />
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
.sess-table {
  flex: 1;
  min-height: 0;
}
.dim {
  color: var(--tc-text-dim);
  font-size: 12px;
}
</style>

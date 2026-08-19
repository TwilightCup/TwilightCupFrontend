<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
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

type StatusFilter = MatchStatus | "ALL";
type ArchiveFilter = "active" | "archived" | "all";

const keyword = ref("");
const statusFilter = ref<StatusFilter>("ALL");
const archiveFilter = ref<ArchiveFilter>("active"); // 默认隐藏已归档，保持工作列表干净
const page = ref(1);
const pageSize = ref(20);

const statusOptions = computed(() => [
  { value: "ALL" as StatusFilter, label: t("admin.matches.filterAll") },
  ...([MatchStatus.CREATED, MatchStatus.RUNNING, MatchStatus.PAUSED, MatchStatus.ENDED] as MatchStatus[]).map(
    (s) => ({ value: s, label: matchStatusInfo(s).label }),
  ),
]);

const archiveOptions = computed(() => [
  { value: "active" as ArchiveFilter, label: t("admin.matches.filterActive") },
  { value: "archived" as ArchiveFilter, label: t("admin.matches.filterArchived") },
  { value: "all" as ArchiveFilter, label: t("admin.matches.filterAll") },
]);

const filtered = computed<MatchOut[]>(() => {
  const kw = keyword.value.trim().toLowerCase();
  return admin.matches.filter((m) => {
    if (statusFilter.value !== "ALL" && m.status !== statusFilter.value) return false;
    if (archiveFilter.value === "archived" && !m.archived_at) return false;
    if (archiveFilter.value === "active" && m.archived_at) return false;
    if (!kw) return true;
    return (
      m.name.toLowerCase().includes(kw) ||
      m.player_a_username.toLowerCase().includes(kw) ||
      m.player_b_username.toLowerCase().includes(kw)
    );
  });
});

const paged = computed<MatchOut[]>(() =>
  filtered.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value),
);

const emptyText = computed(() =>
  admin.matches.length === 0 ? t("admin.matches.empty") : t("admin.matches.emptyFiltered"),
);

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

/** 归档已结束比赛（列表整理用；可随时取消归档恢复） */
async function onArchive(row: MatchOut): Promise<void> {
  try {
    await ElMessageBox.confirm(
      t("admin.matches.archiveConfirmMsg", { name: row.name }),
      t("admin.matches.archiveConfirmTitle"),
      { type: "warning", confirmButtonText: t("admin.matches.archiveBtn"), cancelButtonText: t("common.cancel") },
    );
  } catch {
    return;
  }
  await admin.archiveMatch(row.id);
}

/** 取消归档（可逆操作，无需确认框） */
async function onUnarchive(row: MatchOut): Promise<void> {
  await admin.unarchiveMatch(row.id);
}

/** 已归档行整体压暗（row-class-name 挂在内部 tr 上，配合 :deep 样式） */
function rowClass({ row }: { row: MatchOut }): string {
  return row.archived_at ? "archived-row" : "";
}

// 筛选条件变化 → 回到第 1 页
watch([keyword, statusFilter, archiveFilter], () => {
  page.value = 1;
});

// 每页条数变化 → 回到第 1 页，避免停留在越界页码
function onSizeChange(): void {
  page.value = 1;
}

// 数据缩减（如归档掉本页最后一条）→ 钳制到末页，避免空页
watch(
  () => filtered.value.length,
  (n) => {
    const maxPage = Math.max(1, Math.ceil(n / pageSize.value));
    if (page.value > maxPage) page.value = maxPage;
  },
);

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
        <el-input
          v-model="keyword"
          :placeholder="$t('admin.matches.searchPlaceholder')"
          clearable
          style="width: 220px"
        />
        <el-select v-model="statusFilter" style="width: 120px">
          <el-option
            v-for="o in statusOptions"
            :key="String(o.value)"
            :value="o.value"
            :label="o.label"
          />
        </el-select>
        <el-select v-model="archiveFilter" style="width: 120px">
          <el-option
            v-for="o in archiveOptions"
            :key="o.value"
            :value="o.value"
            :label="o.label"
          />
        </el-select>
        <el-button :loading="admin.matchesLoading" @click="admin.loadMatches()">
          {{ $t('common.refresh') }}
        </el-button>
        <el-button type="primary" @click="createOpen = true">{{ $t('admin.matches.createBtn') }}</el-button>
      </div>
    </div>

    <el-table
      :data="paged"
      v-loading="admin.matchesLoading"
      :empty-text="emptyText"
      :row-class-name="rowClass"
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
      <el-table-column :label="$t('admin.matches.colStatus')" width="100">
        <template #default="{ row }">
          <div class="status-cell">
            <el-tag :type="matchStatusInfo(row.status).type" effect="dark" size="small">
              {{ matchStatusInfo(row.status).label }}
            </el-tag>
            <el-tag v-if="row.archived_at" type="info" effect="plain" size="small">
              {{ $t('admin.matches.archivedTag') }}
            </el-tag>
          </div>
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
      <el-table-column :label="$t('common.actions')" width="170" fixed="right">
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
          <el-button
            v-else-if="row.status === MatchStatus.ENDED && !row.archived_at"
            link
            type="warning"
            @click="onArchive(row)"
          >
            {{ $t('admin.matches.archiveBtn') }}
          </el-button>
          <el-button
            v-else-if="row.archived_at"
            link
            type="info"
            @click="onUnarchive(row)"
          >
            {{ $t('admin.matches.unarchiveBtn') }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="pager-row">
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :total="filtered.length"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next"
        background
        @size-change="onSizeChange"
      />
    </div>

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
.pager-row {
  display: flex;
  justify-content: flex-end;
  flex-shrink: 0;
}
.status-cell {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}
:deep(.archived-row) {
  opacity: 0.55;
}
.dim {
  color: var(--tc-text-dim);
  font-size: 12px;
}
</style>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessageBox } from "element-plus";
import { useI18n } from "vue-i18n";
import { useAdminStore } from "@/stores/admin";
import {
  type BracketView,
  type TournamentOut,
  type TournamentStandingOut,
  DEFAULT_TOURNAMENT_ID,
  TournamentFormat,
  TournamentStatus,
} from "@/api/types";
import {
  dateTime,
  tournamentFormatLabel,
  tournamentStatusInfo,
} from "@/utils/format";
import TournamentFormDialog from "@/components/admin/TournamentFormDialog.vue";
import TournamentMembersPanel from "@/components/admin/TournamentMembersPanel.vue";
import BracketViewPanel from "@/components/admin/BracketViewPanel.vue";

const route = useRoute();
const router = useRouter();
const admin = useAdminStore();
const { t } = useI18n();

const id = route.params.id as string;
const tournament = computed<TournamentOut | undefined>(() =>
  admin.tournamentById.get(id),
);
const isDraft = computed(
  () => tournament.value?.status === TournamentStatus.DRAFT,
);
/** 默认赛事（孤立比赛容器）：不可改/删/排赛程，后端 9 个变更端点均 400 */
const isDefault = computed(
  () => tournament.value?.id === DEFAULT_TOURNAMENT_ID,
);

const editOpen = ref(false);
const bracket = ref<BracketView | null>(null);
const standings = ref<TournamentStandingOut[]>([]);

function openEdit(): void {
  editOpen.value = true;
}

async function loadBracketAndStandings(): Promise<void> {
  const tour = tournament.value;
  if (!tour) return;
  if (
    tour.status === TournamentStatus.IN_PROGRESS ||
    tour.status === TournamentStatus.COMPLETED
  ) {
    bracket.value = await admin.loadBracket(tour.id);
    standings.value = (await admin.loadStandings(tour.id)) ?? [];
  } else {
    bracket.value = null;
    standings.value = [];
  }
}

async function reloadBracket(): Promise<void> {
  const tour = tournament.value;
  if (!tour) return;
  bracket.value = await admin.loadBracket(tour.id);
  standings.value = (await admin.loadStandings(tour.id)) ?? standings.value;
}

async function onGenerate(): Promise<void> {
  const tour = tournament.value;
  if (!tour) return;
  try {
    await ElMessageBox.confirm(
      t("admin.tourDetail.generateConfirmMsg"),
      t("admin.tourDetail.generateConfirmTitle"),
      { type: "warning", confirmButtonText: t("admin.tourDetail.generateConfirmBtn"), cancelButtonText: t("common.cancel") },
    );
  } catch {
    return;
  }
  const b = await admin.generateBracket(tour.id);
  if (b) {
    bracket.value = b;
    standings.value = (await admin.loadStandings(tour.id)) ?? [];
  }
}

/** 瑞士轮：进行中时生成下一轮（荷兰式配对） */
const canNextRound = computed(
  () =>
    tournament.value?.format === TournamentFormat.SWISS &&
    tournament.value?.status === TournamentStatus.IN_PROGRESS,
);

async function onNextRound(): Promise<void> {
  const tour = tournament.value;
  if (!tour) return;
  const b = await admin.generateNextRound(tour.id);
  if (b) {
    bracket.value = b;
    standings.value = (await admin.loadStandings(tour.id)) ?? standings.value;
  }
}

watch(
  () => tournament.value?.status,
  (status) => {
    if (
      status === TournamentStatus.IN_PROGRESS ||
      status === TournamentStatus.COMPLETED
    ) {
      loadBracketAndStandings();
    }
  },
);

onMounted(async () => {
  await admin.loadTournament(id);
  await loadBracketAndStandings();
});
</script>

<template>
  <div class="page">
    <el-page-header @back="router.push('/admin/tournaments')">
      <template #content>
        <span class="detail-title">{{ tournament?.name ?? $t('common.loading') }}</span>
        <el-tag
          v-if="tournament"
          :type="tournamentStatusInfo(tournament.status).type"
          size="small"
          effect="dark"
          style="margin-left: 10px"
        >
          {{ tournamentStatusInfo(tournament.status).label }}
        </el-tag>
      </template>
    </el-page-header>

    <div v-if="tournament" class="cards">
      <!-- 基本信息 -->
      <el-card class="card">
        <template #header>
          <div class="card-head">
            <span>{{ $t('admin.tourDetail.basicInfo') }}</span>
            <el-button v-if="isDraft && !isDefault" link type="primary" @click="openEdit">
              {{ $t('common.edit') }}
            </el-button>
          </div>
        </template>
        <el-descriptions :column="3" border>
          <el-descriptions-item :label="$t('admin.tourDetail.descFormat')">
            {{ tournamentFormatLabel(tournament.format) }}
          </el-descriptions-item>
          <el-descriptions-item v-if="tournament.format === TournamentFormat.SWISS" :label="$t('admin.tourDetail.descSwissRounds')">
            {{ tournament.swiss_rounds ?? $t('admin.tourDetail.autoLabel') }}
          </el-descriptions-item>
          <el-descriptions-item v-if="tournament.format === TournamentFormat.SWISS" :label="$t('admin.tourDetail.descSwissPoints')">
            {{ tournament.swiss_win_points }} / {{ tournament.swiss_draw_points }} / {{ tournament.swiss_loss_points }}
          </el-descriptions-item>
          <el-descriptions-item :label="$t('admin.tourDetail.descRoles')">
            {{ tournament.participant_ids.length }} / {{ tournament.referee_ids.length }} / {{ tournament.director_ids.length }}
          </el-descriptions-item>
          <el-descriptions-item :label="$t('common.createdAt')">
            {{ dateTime(tournament.created_at) }}
          </el-descriptions-item>
          <el-descriptions-item v-if="tournament.bracket_generated_at" :label="$t('admin.tourDetail.descBracketGenAt')">
            {{ dateTime(tournament.bracket_generated_at) }}
          </el-descriptions-item>
        </el-descriptions>
        <div class="rule-hint">
          {{ $t('admin.tourDetail.ruleHint') }}
        </div>
      </el-card>

      <!-- 成员池 -->
      <el-card class="card">
        <template #header>
          <div class="card-head">
            <span>{{ $t('admin.tourDetail.membersPool') }}</span>
            <span class="dim">
              {{ isDefault ? $t('admin.tourDetail.defaultMembersHint') : isDraft ? $t('admin.tourDetail.editableHint') : $t('admin.tourDetail.readOnlyHint') }}
            </span>
          </div>
        </template>
        <TournamentMembersPanel :tournament="tournament" />
      </el-card>

      <!-- 赛程 -->
      <el-card class="card">
        <template #header>
          <div class="card-head">
            <span>{{ $t('admin.tourDetail.schedule') }}</span>
          </div>
        </template>

        <div v-if="isDefault" class="dim">
          {{ $t('admin.tourDetail.defaultScheduleHint') }}
        </div>

        <div v-else-if="tournament.status === TournamentStatus.DRAFT" class="gen-area">
          <div class="gen-tip">
            {{ $t('admin.tourDetail.genBracketTip', { count: tournament.participant_ids.length }) }}
          </div>
          <div class="gen-actions">
            <el-button
              type="primary"
              :disabled="tournament.participant_ids.length < 2"
              @click="onGenerate"
            >
              {{ $t('admin.tourDetail.generateBracketBtn') }}
            </el-button>
            <span v-if="tournament.participant_ids.length < 2" class="dim">
              {{ $t('admin.tourDetail.minPlayersHint') }}
            </span>
          </div>
        </div>

        <el-tabs
          v-else-if="
            tournament.status === TournamentStatus.IN_PROGRESS ||
            tournament.status === TournamentStatus.COMPLETED
          "
        >
          <el-tab-pane :label="$t('admin.tourDetail.bracketTab')">
            <div v-if="canNextRound" class="round-actions">
              <el-button type="primary" plain @click="onNextRound">
                {{ $t('admin.tourDetail.nextRoundBtn') }}
              </el-button>
              <span class="dim">{{ $t('admin.tourDetail.swissRoundHint') }}</span>
            </div>
            <BracketViewPanel
              :tournament="tournament"
              :bracket="bracket"
              @changed="reloadBracket"
            />
          </el-tab-pane>
          <el-tab-pane :label="$t('admin.tourDetail.standingsTab', { n: standings.length })">
            <el-table :data="standings" :empty-text="$t('admin.tourDetail.standingsEmpty')" size="small" stripe>
              <el-table-column prop="rank" :label="$t('admin.tourDetail.colRank')" width="70" align="center" />
              <el-table-column
                prop="display_name"
                :label="$t('admin.tourDetail.colPlayer')"
                min-width="140"
              />
              <el-table-column prop="wins" :label="$t('admin.tourDetail.colWins')" width="60" align="center" />
              <el-table-column prop="losses" :label="$t('admin.tourDetail.colLosses')" width="60" align="center" />
              <el-table-column prop="draws" :label="$t('admin.tourDetail.colDraws')" width="60" align="center" />
              <el-table-column
                prop="points"
                :label="$t('admin.tourDetail.colPoints')"
                width="70"
                align="center"
              />
              <el-table-column prop="note" :label="$t('admin.tourDetail.colNote')" min-width="120" />
            </el-table>
          </el-tab-pane>
        </el-tabs>

        <div v-else class="dim">
          {{ $t('admin.tourDetail.noScheduleYet', { label: tournamentStatusInfo(tournament.status).label }) }}
        </div>
      </el-card>
    </div>

    <TournamentFormDialog
      v-model="editOpen"
      :tournament="tournament"
      @done="admin.loadTournament(id)"
    />
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
  min-height: 0;
  overflow: auto;
}
.detail-title {
  font-size: 16px;
  font-weight: 600;
  margin-right: 4px;
}
.cards {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.rule-hint {
  margin-top: 10px;
  font-size: 12px;
  color: var(--tc-text-dim);
  line-height: 1.5;
}
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.card-head .dim {
  font-size: 12px;
  color: var(--tc-text-dim);
}
.dim {
  font-size: 12px;
  color: var(--tc-text-dim);
}
.gen-area {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.gen-tip {
  font-size: 13px;
  line-height: 1.6;
}
.gen-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.round-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
</style>

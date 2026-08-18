<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { useAdminStore } from "@/stores/admin";
import {
  BracketSide,
  FixtureStatus,
  type BracketView,
  type FixtureOut,
  type TournamentOut,
} from "@/api/types";
import { fixtureStatusInfo } from "@/utils/format";
import FixtureAssignDialog from "./FixtureAssignDialog.vue";
import FixtureCreateMatchDialog from "./FixtureCreateMatchDialog.vue";

/**
 * 对阵表展示：按轮次分组渲染 fixtures，提供「指派裁判/导播」「生成实战比赛」操作。
 * 操作完成后 emit('changed')，由父级重新拉取 bracket。
 */
defineProps<{
  tournament: TournamentOut;
  bracket: BracketView | null;
}>();
const emit = defineEmits<{ (e: "changed"): void }>();

const admin = useAdminStore();
const { t } = useI18n();

const assignOpen = ref(false);
const assignFixture = ref<FixtureOut | null>(null);
const createOpen = ref(false);
const createFixture = ref<FixtureOut | null>(null);

function playerLabel(id: string | null, isBye: boolean): string {
  if (isBye) return t("bracket.bye");
  if (!id) return t("bracket.tbd");
  return admin.displayName(id);
}

function officialLabel(id: string | null): string {
  return id ? admin.displayName(id) : t("common.dash");
}

function winnerLabel(f: FixtureOut): string {
  return f.winner_id ? admin.displayName(f.winner_id) : t("common.dash");
}

function sideLabel(side: BracketSide): string {
  if (side === BracketSide.WINNERS) return t("bracket.winners");
  if (side === BracketSide.LOSERS) return t("bracket.losers");
  return "";
}

function canCreateMatch(f: FixtureOut): boolean {
  return (
    !!f.player_a_id &&
    !!f.player_b_id &&
    !f.is_bye &&
    !f.match_id &&
    f.status !== FixtureStatus.COMPLETED &&
    f.status !== FixtureStatus.SKIPPED
  );
}

function openAssign(f: FixtureOut): void {
  assignFixture.value = f;
  assignOpen.value = true;
}

function onCreateMatch(f: FixtureOut): void {
  createFixture.value = f;
  createOpen.value = true;
}

function onAssigned(): void {
  emit("changed");
}
</script>

<template>
  <div class="bracket">
    <div v-if="!bracket || bracket.rounds.length === 0" class="empty">
      {{ $t('bracket.empty') }}
    </div>

    <div v-else class="rounds">
      <div v-for="r in bracket.rounds" :key="r.round_no" class="round">
        <div class="round-head">
          <span class="round-title">{{ $t('bracket.roundTitle', { n: r.round_no }) }}</span>
          <el-tag
            v-if="r.bracket_side !== BracketSide.MAIN"
            size="small"
            type="warning"
            effect="plain"
          >
            {{ sideLabel(r.bracket_side) }}
          </el-tag>
        </div>
        <el-table :data="r.fixtures" size="small" stripe>
          <el-table-column label="#" width="50" align="center">
            <template #default="{ row }">{{ row.match_index + 1 }}</template>
          </el-table-column>
          <el-table-column :label="$t('bracket.colMatchup')" min-width="200">
            <template #default="{ row }">
              <div class="vs">
                <span :class="['side', row.winner_id === row.player_a_id && 'win']">
                  {{ playerLabel(row.player_a_id, row.is_bye) }}
                </span>
                <span class="sep">vs</span>
                <span :class="['side', row.winner_id === row.player_b_id && 'win']">
                  {{ playerLabel(row.player_b_id, false) }}
                </span>
              </div>
            </template>
          </el-table-column>
          <el-table-column :label="$t('bracket.colStatus')" width="100">
            <template #default="{ row }">
              <el-tag
                :type="fixtureStatusInfo(row.status).type"
                size="small"
                effect="plain"
              >
                {{ fixtureStatusInfo(row.status).label }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column :label="$t('bracket.colReferee')" width="110">
            <template #default="{ row }">{{ officialLabel(row.referee_id) }}</template>
          </el-table-column>
          <el-table-column :label="$t('bracket.colDirector')" width="110">
            <template #default="{ row }">{{ officialLabel(row.director_id) }}</template>
          </el-table-column>
          <el-table-column :label="$t('bracket.colWinner')" width="110">
            <template #default="{ row }">{{ winnerLabel(row) }}</template>
          </el-table-column>
          <el-table-column :label="$t('common.actions')" width="220" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openAssign(row)">{{ $t('bracket.assignBtn') }}</el-button>
              <el-button
                v-if="canCreateMatch(row)"
                link
                type="success"
                @click="onCreateMatch(row)"
              >
                {{ $t('bracket.createMatchBtn') }}
              </el-button>
              <span v-else-if="row.match_id" class="match-tag">
                {{ $t('bracket.matchTag', { id: row.match_id.slice(0, 8) }) }}
              </span>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>

    <FixtureAssignDialog
      v-model="assignOpen"
      :fixture="assignFixture"
      :tournament="tournament"
      @done="onAssigned"
    />

    <FixtureCreateMatchDialog
      v-model="createOpen"
      :fixture="createFixture"
      :tournament="tournament"
      @done="onAssigned"
    />
  </div>
</template>

<style scoped>
.bracket {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.empty {
  color: var(--tc-text-dim);
  font-size: 13px;
  padding: 12px 0;
}
.rounds {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.round-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.round-title {
  font-size: 14px;
  font-weight: 600;
}
.vs {
  display: flex;
  align-items: center;
  gap: 8px;
}
.vs .side.win {
  font-weight: 600;
  color: var(--el-color-success);
}
.vs .sep {
  color: var(--tc-text-dim);
  font-size: 12px;
}
.match-tag {
  font-size: 12px;
  color: var(--tc-text-dim);
  font-family: monospace;
}
</style>

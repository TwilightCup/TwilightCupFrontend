<script setup lang="ts">
import { computed, onMounted, ref, watchEffect } from "vue";
import { useAdminStore } from "@/stores/admin";
import {
  AccountType,
  TournamentStatus,
  type TournamentOut,
} from "@/api/types";

/**
 * 赛事成员池管理：参赛选手（加/移）、裁判组（仅加）、导播组（仅加）、种子序排序。
 * 仅 DRAFT 状态可写；非 DRAFT 只读展示名单。后端裁判/导播无「移除」端点，故不提供。
 */
const props = defineProps<{ tournament: TournamentOut }>();
const admin = useAdminStore();

const isDraft = computed(() => props.tournament.status === TournamentStatus.DRAFT);

const pendingPlayers = ref<string[]>([]);
const pendingReferees = ref<string[]>([]);
const pendingDirectors = ref<string[]>([]);

/** 本地种子序（account.id 列表）；随 tournament 变化重新同步 */
const seedOrder = ref<string[]>([]);
watchEffect(() => {
  const t = props.tournament;
  seedOrder.value =
    t.seed_order.length === t.participant_ids.length && t.seed_order.length > 0
      ? [...t.seed_order]
      : [...t.participant_ids];
});

function usernameOf(id: string): string {
  return admin.accountById.get(id)?.username ?? "";
}

function nameOf(id: string): string {
  return admin.displayName(id);
}

const addedPlayerUsernames = computed(
  () => new Set(props.tournament.participant_ids.map(usernameOf)),
);
const addedRefereeUsernames = computed(
  () => new Set(props.tournament.referee_ids.map(usernameOf)),
);
const addedDirectorUsernames = computed(
  () => new Set(props.tournament.director_ids.map(usernameOf)),
);

const playerOptions = computed(() =>
  admin.accounts.filter(
    (a) =>
      a.roles.includes(AccountType.PLAYER) && !addedPlayerUsernames.value.has(a.username),
  ),
);
const refereeOptions = computed(() =>
  admin.accounts.filter(
    (a) =>
      a.roles.includes(AccountType.REFEREE) && !addedRefereeUsernames.value.has(a.username),
  ),
);
const directorOptions = computed(() =>
  admin.accounts.filter(
    (a) =>
      a.roles.includes(AccountType.DIRECTOR) && !addedDirectorUsernames.value.has(a.username),
  ),
);

const participants = computed(() =>
  props.tournament.participant_ids.map((id) => ({
    id,
    name: nameOf(id),
    username: usernameOf(id),
  })),
);
const referees = computed(() =>
  props.tournament.referee_ids.map((id) => ({
    id,
    name: nameOf(id),
    username: usernameOf(id),
  })),
);
const directors = computed(() =>
  props.tournament.director_ids.map((id) => ({
    id,
    name: nameOf(id),
    username: usernameOf(id),
  })),
);

const seedRows = computed(() =>
  seedOrder.value.map((id, idx) => ({
    id,
    seq: idx + 1,
    name: nameOf(id),
    username: usernameOf(id),
  })),
);

async function onAddPlayers(): Promise<void> {
  if (pendingPlayers.value.length === 0) return;
  const t = await admin.addParticipants(props.tournament.id, pendingPlayers.value);
  if (t) pendingPlayers.value = [];
}

async function onRemovePlayer(id: string): Promise<void> {
  const uname = usernameOf(id);
  if (!uname) return;
  await admin.removeParticipants(props.tournament.id, [uname]);
}

async function onAddReferees(): Promise<void> {
  if (pendingReferees.value.length === 0) return;
  const t = await admin.addReferees(props.tournament.id, pendingReferees.value);
  if (t) pendingReferees.value = [];
}

async function onAddDirectors(): Promise<void> {
  if (pendingDirectors.value.length === 0) return;
  const t = await admin.addDirectors(props.tournament.id, pendingDirectors.value);
  if (t) pendingDirectors.value = [];
}

function moveUp(i: number): void {
  if (i <= 0) return;
  const arr = [...seedOrder.value];
  [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
  seedOrder.value = arr;
}

function moveDown(i: number): void {
  const arr = [...seedOrder.value];
  if (i >= arr.length - 1) return;
  [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
  seedOrder.value = arr;
}

async function onSaveSeeds(): Promise<void> {
  await admin.setSeeds(props.tournament.id, seedOrder.value);
}

onMounted(() => {
  admin.loadAccounts();
});
</script>

<template>
  <div class="members-panel">
    <!-- 参赛选手 -->
    <div class="block">
      <div class="block-head">
        <span class="block-title">{{ $t("members.titlePlayers") }}</span>
        <span class="block-count">{{ participants.length }} {{ $t("members.countSuffix") }}</span>
      </div>
      <div v-if="isDraft" class="add-row">
        <el-select
          v-model="pendingPlayers"
          multiple
          filterable
          collapse-tags
          collapse-tags-tooltip
          :placeholder="$t('members.addPlayersPlaceholder')"
          style="flex: 1"
        >
          <el-option
            v-for="a in playerOptions"
            :key="a.id"
            :value="a.username"
            :label="`${a.display_name}（${a.username}）`"
          />
        </el-select>
        <el-button
          type="primary"
          :disabled="pendingPlayers.length === 0"
          @click="onAddPlayers"
        >
          {{ $t("members.addBtn") }}
        </el-button>
      </div>
      <el-table :data="participants" :empty-text="$t('members.emptyPlayers')" size="small" stripe>
        <el-table-column prop="name" :label="$t('members.colDisplayName')" min-width="140" />
        <el-table-column prop="username" :label="$t('members.colUsername')" min-width="140" />
        <el-table-column v-if="isDraft" :label="$t('common.actions')" width="90">
          <template #default="{ row }">
            <el-button link type="danger" @click="onRemovePlayer(row.id)">
              {{ $t("members.removeBtn") }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 裁判组 / 导播组 -->
    <div class="block">
      <div class="block-head">
        <span class="block-title">{{ $t("members.titleReferees") }}</span>
        <span class="block-count">{{ referees.length }} {{ $t("members.countSuffix") }}</span>
      </div>
      <div v-if="isDraft" class="add-row">
        <el-select
          v-model="pendingReferees"
          multiple
          filterable
          collapse-tags
          collapse-tags-tooltip
          :placeholder="$t('members.addRefereesPlaceholder')"
          style="flex: 1"
        >
          <el-option
            v-for="a in refereeOptions"
            :key="a.id"
            :value="a.username"
            :label="`${a.display_name}（${a.username}）`"
          />
        </el-select>
        <el-button
          type="primary"
          :disabled="pendingReferees.length === 0"
          @click="onAddReferees"
        >
          {{ $t("members.addBtn") }}
        </el-button>
      </div>
      <div class="name-list">
        <el-tag v-for="r in referees" :key="r.id" size="small" effect="plain">
          {{ r.name }}
        </el-tag>
        <span v-if="referees.length === 0" class="empty">{{ $t("members.noneTag") }}</span>
      </div>
    </div>

    <div class="block">
      <div class="block-head">
        <span class="block-title">{{ $t("members.titleDirectors") }}</span>
        <span class="block-count">{{ directors.length }} {{ $t("members.countSuffix") }}</span>
      </div>
      <div v-if="isDraft" class="add-row">
        <el-select
          v-model="pendingDirectors"
          multiple
          filterable
          collapse-tags
          collapse-tags-tooltip
          :placeholder="$t('members.addDirectorsPlaceholder')"
          style="flex: 1"
        >
          <el-option
            v-for="a in directorOptions"
            :key="a.id"
            :value="a.username"
            :label="`${a.display_name}（${a.username}）`"
          />
        </el-select>
        <el-button
          type="primary"
          :disabled="pendingDirectors.length === 0"
          @click="onAddDirectors"
        >
          {{ $t("members.addBtn") }}
        </el-button>
      </div>
      <div class="name-list">
        <el-tag v-for="d in directors" :key="d.id" size="small" type="warning" effect="plain">
          {{ d.name }}
        </el-tag>
        <span v-if="directors.length === 0" class="empty">{{ $t("members.noneTag") }}</span>
      </div>
    </div>

    <!-- 种子序 -->
    <div class="block">
      <div class="block-head">
        <span class="block-title">{{ $t("members.titleSeedOrder") }}</span>
        <span class="block-count">{{ $t("members.seedHint") }}</span>
      </div>
      <el-table :data="seedRows" :empty-text="$t('members.emptySeeds')" size="small" stripe>
        <el-table-column prop="seq" :label="$t('members.colSeq')" width="70" align="center" />
        <el-table-column prop="name" :label="$t('members.colDisplayName')" min-width="140" />
        <el-table-column prop="username" :label="$t('members.colUsername')" min-width="140" />
        <el-table-column v-if="isDraft" :label="$t('members.colSort')" width="130">
          <template #default="{ $index }">
            <el-button link type="primary" :disabled="$index === 0" @click="moveUp($index)">
              {{ $t("members.moveUpBtn") }}
            </el-button>
            <el-button
              link
              type="primary"
              :disabled="$index === seedRows.length - 1"
              @click="moveDown($index)"
            >
              {{ $t("members.moveDownBtn") }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <div v-if="isDraft && seedRows.length > 0" class="seeds-foot">
        <el-button type="primary" plain @click="onSaveSeeds">{{ $t("members.saveSeedsBtn") }}</el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.members-panel {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.block-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
}
.block-title {
  font-size: 14px;
  font-weight: 600;
}
.block-count {
  font-size: 12px;
  color: var(--tc-text-dim);
}
.add-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.name-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  min-height: 24px;
}
.name-list .empty {
  font-size: 12px;
  color: var(--tc-text-dim);
}
.seeds-foot {
  margin-top: 4px;
}
</style>

/**
 * 管理员端状态：账号列表与比赛列表的加载及 CRUD。
 *
 * 设计要点：
 * - 账号列表是比赛列表展示（把 player_a_id 等映射为展示名）与比赛创建表单
 *   （按类型筛选选手/裁判/导播）的依赖，故集中缓存。
 * - CRUD 方法内部捕获错误并以 ElMessage 提示，返回 boolean 供视图决定是否
 *   关闭对话框 / 刷新列表（参考裁判端 match store 的错误提示风格）。
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { ElMessage } from "element-plus";

import { api, ApiError } from "@/api/client";
import { MatchStatus } from "@/api/types";
import { t as tr } from "@/locales";
import type {
  AccountCreate,
  AccountOut,
  AccountUpdate,
  BracketView,
  FixtureAssignBody,
  FixtureCreateMatchBody,
  FixtureOut,
  MappoolCreate,
  MappoolLibItem,
  MappoolUpdate,
  Level,
  LevelCreate,
  LevelUpdate,
  MatchCreate,
  MatchOut,
  TournamentCreate,
  TournamentOut,
  TournamentStandingOut,
  TournamentUpdate,
} from "@/api/types";
import { useAuthStore } from "./auth";

export const useAdminStore = defineStore("admin", () => {
  const auth = useAuthStore();

  const accounts = ref<AccountOut[]>([]);
  const accountsLoading = ref(false);
  const accountsLoaded = ref(false);

  const matches = ref<MatchOut[]>([]);
  const matchesLoading = ref(false);

  const mappools = ref<MappoolLibItem[]>([]);
  const mappoolsLoading = ref(false);
  const mappoolsLoaded = ref(false);

  const levels = ref<Level[]>([]);
  const levelsLoading = ref(false);
  const levelsLoaded = ref(false);

  const tournaments = ref<TournamentOut[]>([]);
  const tournamentsLoading = ref(false);
  const tournamentsLoaded = ref(false);

  /** id → 账号，供比赛列表把双方/裁判/导播 id 映射为展示名 */
  const accountById = computed(
    () => new Map<string, AccountOut>(accounts.value.map((a) => [a.id, a])),
  );

  /**
   * accountId → 该选手当前所在的 RUNNING 比赛名（新建比赛选手下拉的占用提示）。
   * 只有 RUNNING 占用选手；PAUSED/CREATED/ENDED 不占用（暂停即释放，可去其他比赛）。
   */
  const playerBusyMap = computed<Map<string, string>>(() => {
    const m = new Map<string, string>();
    for (const s of matches.value) {
      if (s.status === MatchStatus.RUNNING) {
        if (s.player_a_id) m.set(s.player_a_id, s.name);
        if (s.player_b_id) m.set(s.player_b_id, s.name);
      }
    }
    return m;
  });

  /** id → 赛事 */
  const tournamentById = computed(
    () =>
      new Map<string, TournamentOut>(
        tournaments.value.map((t) => [t.id, t]),
      ),
  );

  /** id → 关卡（选图编辑器把 raw.levels 的 id 解析为展示名用） */
  const levelById = computed(
    () => new Map<string, Level>(levels.value.map((l) => [l.id, l])),
  );

  /** name → 关卡（预设按约定名解析 / 遗留名字符串识别用） */
  const levelByName = computed(
    () => new Map<string, Level>(levels.value.map((l) => [l.name, l])),
  );

  function displayName(accountId: string | null | undefined): string {
    if (!accountId) return tr("common.dash");
    return accountById.value.get(accountId)?.display_name ?? tr("toast.unknownAccount");
  }

  function msgOf(e: unknown, fallback: string): string {
    return e instanceof ApiError ? e.message : fallback;
  }

  async function loadAccounts(force = false): Promise<void> {
    if (!auth.token) return;
    if (accountsLoaded.value && !force) return;
    accountsLoading.value = true;
    try {
      accounts.value = await api.listAccounts(auth.token);
      accountsLoaded.value = true;
    } catch (e) {
      ElMessage.error(msgOf(e, tr("toast.loadAccountsFail")));
    } finally {
      accountsLoading.value = false;
    }
  }

  async function loadMatches(): Promise<void> {
    if (!auth.token) return;
    matchesLoading.value = true;
    try {
      matches.value = await api.listMatches(auth.token);
    } catch (e) {
      ElMessage.error(msgOf(e, tr("toast.loadMatchesFail")));
    } finally {
      matchesLoading.value = false;
    }
  }

  async function createAccount(body: AccountCreate): Promise<boolean> {
    if (!auth.token) return false;
    try {
      const acc = await api.createAccount(body, auth.token);
      accounts.value = [...accounts.value, acc];
      ElMessage.success(tr("toast.createAccountOk", { name: acc.username }));
      return true;
    } catch (e) {
      ElMessage.error(msgOf(e, tr("toast.createAccountFail")));
      return false;
    }
  }

  async function updateAccount(
    id: string,
    body: AccountUpdate,
  ): Promise<boolean> {
    if (!auth.token) return false;
    try {
      const acc = await api.updateAccount(id, body, auth.token);
      accounts.value = accounts.value.map((a) => (a.id === id ? acc : a));
      ElMessage.success(tr("toast.updateAccountOk"));
      return true;
    } catch (e) {
      ElMessage.error(msgOf(e, tr("toast.updateAccountFail")));
      return false;
    }
  }

  async function deleteAccount(id: string): Promise<boolean> {
    if (!auth.token) return false;
    try {
      await api.deleteAccount(id, auth.token);
      accounts.value = accounts.value.filter((a) => a.id !== id);
      ElMessage.success(tr("toast.deleteAccountOk"));
      return true;
    } catch (e) {
      ElMessage.error(msgOf(e, tr("toast.deleteAccountFail")));
      return false;
    }
  }

  async function createMatch(body: MatchCreate): Promise<MatchOut | null> {
    if (!auth.token) return null;
    try {
      const s = await api.createMatch(body, auth.token);
      matches.value = [s, ...matches.value];
      ElMessage.success(tr("toast.createMatchOk", { name: s.name }));
      return s;
    } catch (e) {
      ElMessage.error(msgOf(e, tr("toast.createMatchFail")));
      return null;
    }
  }

  async function loadMappools(force = false): Promise<void> {
    if (!auth.token) return;
    if (mappoolsLoaded.value && !force) return;
    mappoolsLoading.value = true;
    try {
      mappools.value = await api.listMappools(auth.token);
      mappoolsLoaded.value = true;
    } catch (e) {
      ElMessage.error(msgOf(e, tr("toast.loadMappoolsFail")));
    } finally {
      mappoolsLoading.value = false;
    }
  }

  async function createMappool(body: MappoolCreate): Promise<MappoolLibItem | null> {
    if (!auth.token) return null;
    try {
      const m = await api.createMappool(body, auth.token);
      mappools.value = [m, ...mappools.value];
      ElMessage.success(tr("toast.createMappoolOk", { name: m.name }));
      return m;
    } catch (e) {
      ElMessage.error(msgOf(e, tr("toast.createMappoolFail")));
      return null;
    }
  }

  async function updateMappool(
    id: string,
    body: MappoolUpdate,
  ): Promise<MappoolLibItem | null> {
    if (!auth.token) return null;
    try {
      const m = await api.updateMappool(id, body, auth.token);
      mappools.value = mappools.value.map((x) => (x.id === id ? m : x));
      ElMessage.success(tr("toast.updateMappoolOk"));
      return m;
    } catch (e) {
      ElMessage.error(msgOf(e, tr("toast.updateMappoolFail")));
      return null;
    }
  }

  async function deleteMappool(id: string): Promise<boolean> {
    if (!auth.token) return false;
    try {
      await api.deleteMappool(id, auth.token);
      mappools.value = mappools.value.filter((x) => x.id !== id);
      ElMessage.success(tr("toast.deleteMappoolOk"));
      return true;
    } catch (e) {
      ElMessage.error(msgOf(e, tr("toast.deleteMappoolFail")));
      return false;
    }
  }

  // ---- 关卡（「关卡管理」页） ----------------------------------------------

  async function loadLevels(force = false): Promise<void> {
    if (!auth.token) return;
    if (levelsLoaded.value && !force) return;
    levelsLoading.value = true;
    try {
      levels.value = await api.listLevels(auth.token);
      levelsLoaded.value = true;
    } catch (e) {
      ElMessage.error(msgOf(e, tr("toast.loadLevelsFail")));
    } finally {
      levelsLoading.value = false;
    }
  }

  async function createLevel(body: LevelCreate): Promise<Level | null> {
    if (!auth.token) return null;
    try {
      const lv = await api.createLevel(body, auth.token);
      levels.value = [lv, ...levels.value];
      ElMessage.success(tr("toast.createLevelOk", { name: lv.name }));
      return lv;
    } catch (e) {
      // 后端重名 409 → 专用提示；其余走通用
      if (e instanceof ApiError && e.code === 409) {
        ElMessage.error(tr("toast.levelNameExists", { name: body.name }));
      } else {
        ElMessage.error(msgOf(e, tr("toast.createLevelFail")));
      }
      return null;
    }
  }

  async function updateLevel(
    id: string,
    body: LevelUpdate,
  ): Promise<Level | null> {
    if (!auth.token) return null;
    try {
      const lv = await api.updateLevel(id, body, auth.token);
      levels.value = levels.value.map((x) => (x.id === id ? lv : x));
      ElMessage.success(tr("toast.updateLevelOk"));
      return lv;
    } catch (e) {
      ElMessage.error(msgOf(e, tr("toast.updateLevelFail")));
      return null;
    }
  }

  async function deleteLevel(id: string): Promise<boolean> {
    if (!auth.token) return false;
    try {
      await api.deleteLevel(id, auth.token);
      levels.value = levels.value.filter((x) => x.id !== id);
      ElMessage.success(tr("toast.deleteLevelOk"));
      return true;
    } catch (e) {
      ElMessage.error(msgOf(e, tr("toast.deleteLevelFail")));
      return false;
    }
  }

  // ---- 赛事 ------------------------------------------------------------

  async function loadTournaments(force = false): Promise<void> {
    if (!auth.token) return;
    if (!force && tournamentsLoaded.value) return;
    tournamentsLoading.value = true;
    try {
      tournaments.value = await api.listTournaments(auth.token);
      tournamentsLoaded.value = true;
    } catch (e) {
      ElMessage.error(msgOf(e, tr("toast.loadTournamentsFail")));
    } finally {
      tournamentsLoading.value = false;
    }
  }

  /** 详情页加载单个赛事并 upsert 进列表（不依赖列表是否含该赛季筛选） */
  async function loadTournament(id: string): Promise<TournamentOut | null> {
    const token = auth.token;
    if (!token) return null;
    try {
      const t = await api.getTournament(id, token);
      const idx = tournaments.value.findIndex((x) => x.id === id);
      if (idx >= 0) tournaments.value[idx] = t;
      else tournaments.value = [t, ...tournaments.value];
      return t;
    } catch (e) {
      ElMessage.error(msgOf(e, tr("toast.loadTournamentFail")));
      return null;
    }
  }

  async function createTournament(
    body: TournamentCreate,
  ): Promise<TournamentOut | null> {
    if (!auth.token) return null;
    try {
      const t = await api.createTournament(body, auth.token);
      tournaments.value = [t, ...tournaments.value];
      ElMessage.success(tr("toast.createTournamentOk", { name: t.name }));
      return t;
    } catch (e) {
      ElMessage.error(msgOf(e, tr("toast.createTournamentFail")));
      return null;
    }
  }

  async function updateTournament(
    id: string,
    body: TournamentUpdate,
  ): Promise<TournamentOut | null> {
    if (!auth.token) return null;
    try {
      const t = await api.updateTournament(id, body, auth.token);
      tournaments.value = tournaments.value.map((x) => (x.id === id ? t : x));
      ElMessage.success(tr("toast.updateTournamentOk"));
      return t;
    } catch (e) {
      ElMessage.error(msgOf(e, tr("toast.updateTournamentFail")));
      return null;
    }
  }

  async function deleteTournament(id: string): Promise<boolean> {
    if (!auth.token) return false;
    try {
      await api.deleteTournament(id, auth.token);
      tournaments.value = tournaments.value.filter((x) => x.id !== id);
      ElMessage.success(tr("toast.deleteTournamentOk"));
      return true;
    } catch (e) {
      ElMessage.error(msgOf(e, tr("toast.deleteTournamentFail")));
      return false;
    }
  }

  // 成员池（仅 DRAFT）：调 API → 用返回的 TournamentOut 原地替换
  async function addParticipants(
    id: string,
    usernames: string[],
  ): Promise<TournamentOut | null> {
    const token = auth.token;
    if (!token) return null;
    try {
      const t = await api.addParticipants(id, { usernames }, token);
      tournaments.value = tournaments.value.map((x) => (x.id === id ? t : x));
      ElMessage.success(tr("toast.addParticipantsOk"));
      return t;
    } catch (e) {
      ElMessage.error(msgOf(e, tr("toast.addParticipantsFail")));
      return null;
    }
  }

  async function removeParticipants(
    id: string,
    usernames: string[],
  ): Promise<TournamentOut | null> {
    const token = auth.token;
    if (!token) return null;
    try {
      const t = await api.removeParticipants(id, { usernames }, token);
      tournaments.value = tournaments.value.map((x) => (x.id === id ? t : x));
      ElMessage.success(tr("toast.removeParticipantsOk"));
      return t;
    } catch (e) {
      ElMessage.error(msgOf(e, tr("toast.removeParticipantsFail")));
      return null;
    }
  }

  async function addReferees(
    id: string,
    usernames: string[],
  ): Promise<TournamentOut | null> {
    const token = auth.token;
    if (!token) return null;
    try {
      const t = await api.addReferees(id, { usernames }, token);
      tournaments.value = tournaments.value.map((x) => (x.id === id ? t : x));
      ElMessage.success(tr("toast.addRefereesOk"));
      return t;
    } catch (e) {
      ElMessage.error(msgOf(e, tr("toast.addRefereesFail")));
      return null;
    }
  }

  async function addDirectors(
    id: string,
    usernames: string[],
  ): Promise<TournamentOut | null> {
    const token = auth.token;
    if (!token) return null;
    try {
      const t = await api.addDirectors(id, { usernames }, token);
      tournaments.value = tournaments.value.map((x) => (x.id === id ? t : x));
      ElMessage.success(tr("toast.addDirectorsOk"));
      return t;
    } catch (e) {
      ElMessage.error(msgOf(e, tr("toast.addDirectorsFail")));
      return null;
    }
  }

  async function setSeeds(
    id: string,
    seedOrder: string[],
  ): Promise<TournamentOut | null> {
    const token = auth.token;
    if (!token) return null;
    try {
      const t = await api.setSeeds(id, { seed_order: seedOrder }, token);
      tournaments.value = tournaments.value.map((x) => (x.id === id ? t : x));
      ElMessage.success(tr("toast.setSeedsOk"));
      return t;
    } catch (e) {
      ElMessage.error(msgOf(e, tr("toast.setSeedsFail")));
      return null;
    }
  }

  // ---- 赛程推进 --------------------------------------------------------

  async function generateBracket(id: string): Promise<BracketView | null> {
    const token = auth.token;
    if (!token) return null;
    try {
      const bracket = await api.generateBracket(id, token);
      // 同步刷新赛事状态（DRAFT → IN_PROGRESS）
      const t = await api.getTournament(id, token);
      tournaments.value = tournaments.value.map((x) => (x.id === id ? t : x));
      ElMessage.success(tr("toast.generateBracketOk"));
      return bracket;
    } catch (e) {
      ElMessage.error(msgOf(e, tr("toast.generateBracketFail")));
      return null;
    }
  }

  /** 瑞士轮：按当前积分荷兰式配对生成下一轮（淘汰赛返回 400） */
  async function generateNextRound(id: string): Promise<BracketView | null> {
    const token = auth.token;
    if (!token) return null;
    try {
      const bracket = await api.generateNextRound(id, token);
      ElMessage.success(tr("toast.generateNextRoundOk"));
      return bracket;
    } catch (e) {
      ElMessage.error(msgOf(e, tr("toast.generateNextRoundFail")));
      return null;
    }
  }

  /** 查看对阵表；未生成时后端可能 404/400，这里静默返回 null */
  async function loadBracket(id: string): Promise<BracketView | null> {
    const token = auth.token;
    if (!token) return null;
    try {
      return await api.getBracket(id, token);
    } catch {
      return null;
    }
  }

  /** 查看排名；赛事不存在等异常静默返回 null */
  async function loadStandings(
    id: string,
  ): Promise<TournamentStandingOut[] | null> {
    const token = auth.token;
    if (!token) return null;
    try {
      return await api.getStandings(id, token);
    } catch {
      return null;
    }
  }

  async function assignOfficials(
    tournamentId: string,
    fixtureId: string,
    body: FixtureAssignBody,
  ): Promise<FixtureOut | null> {
    const token = auth.token;
    if (!token) return null;
    try {
      const f = await api.assignOfficials(tournamentId, fixtureId, body, token);
      ElMessage.success(tr("toast.assignOfficialsOk"));
      return f;
    } catch (e) {
      ElMessage.error(msgOf(e, tr("toast.assignOfficialsFail")));
      return null;
    }
  }

  async function createMatchForFixture(
    tournamentId: string,
    fixtureId: string,
    body: FixtureCreateMatchBody,
  ): Promise<MatchOut | null> {
    const token = auth.token;
    if (!token) return null;
    try {
      const s = await api.createMatchForFixture(tournamentId, fixtureId, body, token);
      ElMessage.success(tr("toast.createFixtureMatchOk", { name: s.name }));
      return s;
    } catch (e) {
      ElMessage.error(msgOf(e, tr("toast.createFixtureMatchFail")));
      return null;
    }
  }

  /** 管理员强制结束比赛（RUNNING/CREATED → ENDED），用于卡住时释放选手 */
  async function forceEndMatch(matchId: string): Promise<boolean> {
    const token = auth.token;
    if (!token) return false;
    try {
      await api.forceEndMatch(matchId, token);
      // 后端已置 ENDED；本地列表里同步状态以便即时反映
      matches.value = matches.value.map((m) =>
        m.id === matchId
          ? { ...m, status: MatchStatus.ENDED, ended_at: new Date().toISOString() }
          : m,
      );
      ElMessage.success(tr("toast.forceEndMatchOk"));
      return true;
    } catch (e) {
      ElMessage.error(msgOf(e, tr("toast.forceEndMatchFail")));
      return false;
    }
  }

  /** 归档已结束比赛（archived_at 置时间；纯列表整理，不影响状态机/选手占用） */
  async function archiveMatch(matchId: string): Promise<boolean> {
    const token = auth.token;
    if (!token) return false;
    try {
      const m = await api.archiveMatch(matchId, token);
      matches.value = matches.value.map((x) => (x.id === matchId ? m : x));
      ElMessage.success(tr("toast.archiveMatchOk"));
      return true;
    } catch (e) {
      ElMessage.error(msgOf(e, tr("toast.archiveMatchFail")));
      return false;
    }
  }

  /** 取消归档（archived_at 置 null，比赛回到普通已结束状态） */
  async function unarchiveMatch(matchId: string): Promise<boolean> {
    const token = auth.token;
    if (!token) return false;
    try {
      const m = await api.unarchiveMatch(matchId, token);
      matches.value = matches.value.map((x) => (x.id === matchId ? m : x));
      ElMessage.success(tr("toast.unarchiveMatchOk"));
      return true;
    } catch (e) {
      ElMessage.error(msgOf(e, tr("toast.unarchiveMatchFail")));
      return false;
    }
  }

  return {
    accounts,
    accountsLoading,
    accountsLoaded,
    matches,
    matchesLoading,
    mappools,
    mappoolsLoading,
    mappoolsLoaded,
    levels,
    levelsLoading,
    levelsLoaded,
    tournaments,
    tournamentsLoading,
    tournamentsLoaded,
    accountById,
    playerBusyMap,
    displayName,
    tournamentById,
    levelById,
    levelByName,
    loadAccounts,
    loadMatches,
    createAccount,
    updateAccount,
    deleteAccount,
    createMatch,
    loadMappools,
    createMappool,
    updateMappool,
    deleteMappool,
    loadLevels,
    createLevel,
    updateLevel,
    deleteLevel,
    loadTournaments,
    loadTournament,
    createTournament,
    updateTournament,
    deleteTournament,
    addParticipants,
    removeParticipants,
    addReferees,
    addDirectors,
    setSeeds,
    generateBracket,
    generateNextRound,
    loadBracket,
    loadStandings,
    assignOfficials,
    createMatchForFixture,
    forceEndMatch,
    archiveMatch,
    unarchiveMatch,
  };
});

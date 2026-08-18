/**
 * 裁判端 ban/pick 草稿引擎（纯前端状态机 + 规则校验）。
 *
 * 设计要点（详见 /Users/guojianglong/.claude/plans/purrfect-finding-cocke.md）：
 * - 文档操作均由裁判手动驱动；本 store 引导流程并在前端校验规则，最终选图 / 开局仍走
 *   match store 的既有协议（selectPick / manualStart / !timer）。
 * - 草稿态不入后端；按 matchId 持久化到 localStorage，刷新可恢复。
 * - 图池来源：admin-as-referee 账号走 api.getMatch（结构化图池）；纯裁判账号 403 →
 *   提供 JSON 导入兜底（见 BanPickPanel 的 LOAD 区）。
 * - 流程：LOAD → ROLL → TAG_BAN → DRAFT(ban/protect，整场一次) → PICK → PREP；
 *   后续回合跳过 ban/protect 直接到 PICK；双赛点 → TB_FORCE。
 */
import { defineStore } from "pinia";
import { computed, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";

import { api, ApiError } from "@/api/client";
import {
  CategoryKind,
  MatchPhase,
  MatchStatus,
  PickType,
  type CategoryKind as CK,
  type Mappool,
  type Pick,
} from "@/api/types";
import {
  CT_TAG_BASE,
  categoryKindOf,
  normalizeMappool,
  validateMappool,
} from "@/utils/mappool";
import { useMatchStore } from "./match";
import { useAuthStore } from "./auth";
import { t as tr } from "@/locales";

export type Side = "A" | "B";
export type Stage =
  | "LOAD"
  | "ROLL"
  | "TAG_BAN"
  | "DRAFT"
  | "PICK"
  | "PREP"
  | "TB_FORCE";

export interface MapAction {
  by: Side;
  code: string;
  kind: "ban" | "protect";
}

/** 一轮 ban/pick 流程的可变状态（持久化单位）。 */
interface DraftState {
  stage: Stage;
  rollA: number | null;
  rollB: number | null;
  /** 高 roll 方选择的 pick 顺序对应先手方 */
  pickFirst: Side | null;
  /** 低 roll 方选择的 ban 顺序对应先手方 */
  banFirst: Side | null;
  bannedTags: string[];
  tagBanBy: { A: string | null; B: string | null };
  /** 各方是否已在 tag ban 环节做出决定（ban 某词条或放弃都算；用于与“尚未操作”区分） */
  tagBanActed: { A: boolean; B: boolean };
  actions: MapAction[];
  /** 已 pick 的选图（跨回合累积，按 pick 顺序）；用于锁定、避免重复 pick。
   *  tags：CT/EX/CP 选图随选图提交的词条（随 draft_sync 上报，供导播叠加层展示）
   *  retry：CT/EX 单关裁判指定的重试次数 */
  picks: { by: Side; code: string; tags?: string[]; retry?: number }[];
  draftDone: boolean;
  /** 下一回合该谁 pick（确认后翻转，跨回合延续） */
  nextPicker: Side | null;
  usedTimeout: { A: boolean; B: boolean };
  tbTimeoutUsed: boolean;
}

function freshState(): DraftState {
  return {
    stage: "LOAD",
    rollA: null,
    rollB: null,
    pickFirst: null,
    banFirst: null,
    bannedTags: [],
    tagBanBy: { A: null, B: null },
    tagBanActed: { A: false, B: false },
    actions: [],
    picks: [],
    draftDone: false,
    nextPicker: null,
    usedTimeout: { A: false, B: false },
    tbTimeoutUsed: false,
  };
}

const other = (s: Side): Side => (s === "A" ? "B" : "A");

function storageKey(sid: string): string {
  return `twc-draft:${sid}`;
}

export const useDraftStore = defineStore("draft", () => {
  const match = useMatchStore();
  const auth = useAuthStore();

  const mappool = ref<Mappool | null>(null);
  const mappoolSource = ref<"" | "session" | "import">("");
  const loadError = ref("");

  /** 每方 ban / protect 数（比赛级配置，由管理员在创建比赛时设定，载入比赛时读取）。 */
  const banCount = ref(1);
  const protectCount = ref(1);
  /** CT 选图每次 pick 可附带的词条数上限（比赛级配置；0=禁用词条，默认 2）。 */
  const ctTagCount = ref(2);

  /** 比赛生命周期状态（CREATED/RUNNING/ENDED）；CREATED 时需裁判先「开始比赛」激活，选手方可连入。 */
  const matchStatus = ref<MatchStatus>(MatchStatus.CREATED);
  const needsStart = computed(() => matchStatus.value === MatchStatus.CREATED);
  /** 进行中可暂停；已暂停可恢复（PAUSED 不占用选手，释放后可分配到其他比赛） */
  const canPause = computed(() => matchStatus.value === MatchStatus.RUNNING);
  const canResume = computed(() => matchStatus.value === MatchStatus.PAUSED);

  const state = reactive<DraftState>(freshState());

  // =========================================================================
  // 派生：roll / 顺序
  // =========================================================================

  const rollsSet = computed(() => state.rollA != null && state.rollB != null);
  const rollTie = computed(() => rollsSet.value && state.rollA === state.rollB);
  const highRoller = computed<Side | null>(() => {
    if (!rollsSet.value || rollTie.value) return null;
    return (state.rollA ?? 0) > (state.rollB ?? 0) ? "A" : "B";
  });
  const lowRoller = computed<Side | null>(() =>
    highRoller.value ? other(highRoller.value) : null,
  );
  const ordersDecided = computed(() => state.pickFirst != null && state.banFirst != null);

  // =========================================================================
  // 派生：CT 词条 ban
  // =========================================================================

  /** CT 词条禁用候选：固定枚举（CT 选图定义时不预录词条，由选手 pick 时再选）。 */
  const ctTagChoices = computed<string[]>(() => {
    const hasCT = mappool.value?.categories.some(
      (c) => categoryKindOf(c.name) === CategoryKind.CT,
    );
    return hasCT ? [...CT_TAG_BASE] : [];
  });
  const tagBanDone = computed(() => state.tagBanActed.A && state.tagBanActed.B);

  // =========================================================================
  // 派生：选图 ban/protect 槽位
  // =========================================================================

  /**
   * 依比赛配置(banCount/protectCount) + banFirst 生成 ban/protect 的有序槽位。
   * 顺序：先 protect 后 ban；每段内蛇形 snake（先手方起，逐轮翻转方向），
   * 与文档一致：标准(1,1)→P,P,B,B；深度(2,0)→B,B,B,B 呈 1-2-1。
   */
  const draftSlots = computed<{ side: Side; kind: "ban" | "protect" }[]>(() => {
    const f = state.banFirst;
    if (!f) return [];
    const o = other(f);
    const slots: { side: Side; kind: "ban" | "protect" }[] = [];
    const snake = (kind: "ban" | "protect", count: number): void => {
      for (let r = 0; r < count; r++) {
        const pair: Side[] = r % 2 === 0 ? [f, o] : [o, f];
        for (const side of pair) slots.push({ side, kind });
      }
    };
    snake("protect", protectCount.value);
    snake("ban", banCount.value);
    return slots;
  });
  const currentSlot = computed(() => {
    const i = state.actions.length;
    return i < draftSlots.value.length ? { ...draftSlots.value[i], index: i } : null;
  });
  const draftDone = computed(
    () => state.actions.length >= draftSlots.value.length && draftSlots.value.length > 0,
  );

  // =========================================================================
  // 派生：选图状态 / 合法 pick
  // =========================================================================

  function pickByCode(code: string): Pick | null {
    return mappool.value?.categories.flatMap((c) => c.picks).find((p) => p.code === code) ?? null;
  }
  function kindOfCode(code: string): CK | null {
    const cat = mappool.value?.categories.find((c) => c.picks.some((p) => p.code === code));
    return cat ? categoryKindOf(cat.name) : null;
  }
  /** CT/EX 单关：重试次数改由裁判选图时指定（必填）。 */
  function needsRefereeRetry(code: string): boolean {
    const p = pickByCode(code);
    if (p?.type !== PickType.SINGLE) return false;
    const k = kindOfCode(code);
    return k === CategoryKind.CT || k === CategoryKind.EX;
  }
  /** 可携带词条的类别：CT/EX（裁判选定）、CP（自动 Checkpoint）。 */
  function isTaggedKind(code: string): boolean {
    const k = kindOfCode(code);
    return k === CategoryKind.CT || k === CategoryKind.EX || k === CategoryKind.CP;
  }
  function codeLabel(code: string): string {
    const p = pickByCode(code);
    return p ? `${p.code}${p.name ? " · " + p.name : ""}` : code;
  }

  interface MapStatus {
    bannedBy: Side | null;
    protectedBy: Side | null;
    pickedBy: Side | null;
  }
  function mapStatus(code: string): MapStatus {
    let bannedBy: Side | null = null;
    let protectedBy: Side | null = null;
    for (const a of state.actions) {
      if (a.code === code) {
        if (a.kind === "ban") bannedBy = a.by;
        else protectedBy = a.by;
      }
    }
    const picked = state.picks.find((p) => p.code === code);
    return { bannedBy, protectedBy, pickedBy: picked ? picked.by : null };
  }

  /** 校验某选图能否作为当前槽位的目标；返回不合法原因（合法返回 null）。 */
  function validateChoice(code: string): string | null {
    const slot = currentSlot.value;
    if (!slot) return tr("toast.draftNoSlot");
    const kind = kindOfCode(code);
    if (kind === CategoryKind.TB) return tr("toast.draftTbNotBanProtect");
    const st = mapStatus(code);
    if (st.bannedBy || st.protectedBy || st.pickedBy) return tr("toast.draftMapUnavailable");
    if (protectCount.value > 0) {
      // 同一方的 ban 与 protect 不可同类别（仅当存在 protect 时适用）
      const myOther = state.actions.find((a) => a.by === slot.side && a.code !== code);
      if (myOther) {
        const otherKind = kindOfCode(myOther.code);
        if (otherKind && otherKind === kind) {
          return tr("toast.draftSameKindBanProtect", { kind: otherKind });
        }
      }
    }
    return null;
  }

  const tbCode = computed<string | null>(() => {
    const tb = mappool.value?.categories.find((c) => categoryKindOf(c.name) === CategoryKind.TB);
    return tb?.picks[0]?.code ?? null;
  });

  /** 双赛点：双方分数都到 threshold-1。 */
  const isDoubleMatchPoint = computed(() => {
    const t = match.winThreshold;
    if (!t) return false;
    return match.winsA === t - 1 && match.winsB === t - 1;
  });

  /** 当前 pick 阶段合法选图（不含 TB；排除已 ban 与对方 protect）。 */
  const legalPicks = computed<Pick[]>(() => {
    const picker = state.nextPicker ?? undefined;
    const all = mappool.value?.categories.flatMap((c) => c.picks) ?? [];
    return all.filter((p) => {
      if (kindOfCode(p.code) === CategoryKind.TB) return false;
      const st = mapStatus(p.code);
      if (st.bannedBy) return false;
      if (st.pickedBy) return false; // 已 pick 过的图不可重复选
      if (st.protectedBy && picker && st.protectedBy !== picker) return false;
      return true;
    });
  });

  // =========================================================================
  // 图池载入
  // =========================================================================

  async function loadFromMatch(sid: string, token: string): Promise<void> {
    loadError.value = "";
    try {
      // 成员可见的比赛详情（含结构化图池 + ban/protect 配置），裁判无需管理员权限
      const s = await api.getMyMatch(sid, token);
      setMappool(normalizeMappool(s.mappool), "session");
      banCount.value = s.ban_count ?? 1;
      protectCount.value = s.protect_count ?? 1;
      ctTagCount.value = s.ct_tag_count ?? 2;
      matchStatus.value = s.status;
      afterMappoolLoaded(sid);
    } catch (e) {
      loadError.value = (e as Error)?.message ?? tr("toast.draftLoadMappoolFail");
      state.stage = "LOAD";
    }
  }

  function importMappoolJson(text: string): string | null {
    let obj: unknown;
    try {
      obj = JSON.parse(text);
    } catch {
      return tr("toast.draftJsonParseFail");
    }
    if (!obj || typeof obj !== "object" || !Array.isArray((obj as Mappool).categories)) {
      return tr("toast.draftInvalidStructure");
    }
    const issues = validateMappool(obj as Mappool).filter((i) => i.level === "error");
    if (issues.length > 0) return issues[0].msg;
    setMappool(normalizeMappool(obj as Mappool), "import");
    afterMappoolLoaded(match.matchId ?? "");
    return null;
  }

  function setMappool(m: Mappool, src: "session" | "import"): void {
    mappool.value = m;
    mappoolSource.value = src;
  }

  /** 图池就绪后：尝试恢复持久化草稿，否则进入 ROLL。 */
  function afterMappoolLoaded(sid: string): void {
    if (sid && restorePersisted(sid)) return;
    enterStage("ROLL");
  }

  // =========================================================================
  // 持久化
  // =========================================================================

  function persistNow(): void {
    const sid = match.matchId;
    if (!sid) return;
    try {
      localStorage.setItem(storageKey(sid), JSON.stringify(snapshot()));
    } catch {
      // 忽略配额/隐私模式错误
    }
  }

  function snapshot(): DraftState {
    return JSON.parse(JSON.stringify(state)) as DraftState;
  }

  function restorePersisted(sid: string): boolean {
    try {
      const raw = localStorage.getItem(storageKey(sid));
      if (!raw) return false;
      const saved = JSON.parse(raw) as Partial<DraftState>;
      // 仅恢复已真正进入流程的草稿：LOAD 表示上次未成功载入图池（如旧的 403 场景），
      // 丢弃以免覆盖本次成功载入（否则会一直停在「导入图池」提示）。
      if (!saved.stage || saved.stage === "LOAD") {
        localStorage.removeItem(storageKey(sid));
        return false;
      }
      // 只回填已知字段，避免旧版本残留键（如 banMode）污染 state
      Object.assign(state, freshState(), {
        stage: saved.stage,
        rollA: saved.rollA ?? null,
        rollB: saved.rollB ?? null,
        pickFirst: saved.pickFirst ?? null,
        banFirst: saved.banFirst ?? null,
        bannedTags: saved.bannedTags ?? [],
        tagBanBy: saved.tagBanBy ?? { A: null, B: null },
        tagBanActed: saved.tagBanActed ?? { A: false, B: false },
        actions: saved.actions ?? [],
        picks: saved.picks ?? [],
        draftDone: saved.draftDone ?? false,
        nextPicker: saved.nextPicker ?? null,
        usedTimeout: saved.usedTimeout ?? { A: false, B: false },
        tbTimeoutUsed: saved.tbTimeoutUsed ?? false,
      });
      return true;
    } catch {
      return false;
    }
  }

  // 任意状态变更即持久化 + 同步给导播（后端转发 ban/pick 草稿）
  watch(
    state,
    () => {
      persistNow();
      if (match.matchId)
        match.sendDraft(snapshot() as unknown as Record<string, unknown>);
    },
    { deep: true },
  );

  // =========================================================================
  // 与比赛阶段同步（监听 match.phase / 比分）
  // =========================================================================

  watch(
    () => match.phase,
    (ph) => {
      // 比赛重新开始 / 回合结束后的下一轮
      if (state.stage === "LOAD" || !mappool.value) return;
      // 进入下一回合 pick（ROUND_END 且 ban/protect 已完成）
      if (ph === MatchPhase.ROUND_END || ph === MatchPhase.IDLE) {
        if (isDoubleMatchPoint.value && state.stage !== "TB_FORCE") {
          enterStage("TB_FORCE");
        } else if (state.draftDone) {
          enterStage("PICK");
        }
      }
    },
  );

  watch(isDoubleMatchPoint, (dmp) => {
    if (dmp && mappool.value && state.stage === "PICK") {
      enterStage("TB_FORCE");
    }
  });

  // =========================================================================
  // 名称（仅 UI 展示用；draft 不再向聊天自动播报）
  // =========================================================================

  function nameOf(side: Side): string {
    return side === "A" ? (match.playerNames.A || tr("seat.a")) : (match.playerNames.B || tr("seat.b"));
  }

  // =========================================================================
  // 阶段切换
  // =========================================================================

  function enterStage(stage: Stage): void {
    state.stage = stage;
    if (stage === "PICK" && !state.nextPicker && state.pickFirst) {
      state.nextPicker = state.pickFirst;
    }
  }

  // =========================================================================
  // 动作：ROLL
  // =========================================================================

  function setRolls(a: number, b: number): void {
    state.rollA = a;
    state.rollB = b;
  }
  function decidePickFirst(side: Side): void {
    state.pickFirst = side;
  }
  function decideBanFirst(side: Side): void {
    state.banFirst = side;
    if (ordersDecided.value) {
      // 无 CT 选图时跳过词条禁用，直入 ban/protect
      enterStage(ctTagChoices.value.length > 0 ? "TAG_BAN" : "DRAFT");
    }
  }

  // =========================================================================
  // 动作：TAG_BAN
  // =========================================================================

  function banTag(side: Side, tag: string | null): void {
    state.tagBanBy[side] = tag;
    state.tagBanActed[side] = true;
    if (tag && !state.bannedTags.includes(tag)) state.bannedTags.push(tag);
    if (tagBanDone.value) enterStage("DRAFT");
  }

  /** 无 CT 选图时整体跳过词条禁用。 */
  function skipTagBan(): void {
    state.tagBanBy.A = null;
    state.tagBanBy.B = null;
    state.tagBanActed.A = true;
    state.tagBanActed.B = true;
    enterStage("DRAFT");
  }

  // =========================================================================
  // 动作：DRAFT（ban/protect）
  // =========================================================================

  function chooseMap(code: string): void {
    const err = validateChoice(code);
    if (err) return;
    const slot = currentSlot.value;
    if (!slot) return;
    state.actions.push({ by: slot.side, code, kind: slot.kind });
    if (draftDone.value) {
      state.draftDone = true;
      state.nextPicker = state.pickFirst;
      enterStage("PICK");
    }
  }

  function undoLastAction(): void {
    state.actions.pop();
  }

  // =========================================================================
  // 动作：PICK
  // =========================================================================

  function confirmPick(code: string): void {
    const legal = legalPicks.value.some((p) => p.code === code);
    if (!legal) return;
    const picker = state.nextPicker ?? "A";
    state.picks.push({ by: picker, code });
    enterPrep(code);
    state.nextPicker = other(picker);
  }

  /** 携带词条 / 重试次数的确认 pick（随 referee_select_pick 一并提交，并记入草稿快照）。 */
  function confirmPickWithOptions(code: string, tags: string[], retry?: number): void {
    const legal = legalPicks.value.some((p) => p.code === code);
    if (!legal) return;
    const picker = state.nextPicker ?? "A";
    state.picks.push({
      by: picker,
      code,
      ...(tags.length > 0 ? { tags } : {}),
      ...(retry != null ? { retry } : {}),
    });
    enterPrep(code, tags, retry);
    state.nextPicker = other(picker);
  }

  function randomPick(): void {
    // CT/EX 单关的重试次数需裁判指定（必填），随机选跳过之；全池皆此时回退原池
    const all = legalPicks.value;
    const pool = all.filter(
      (p) =>
        !(
          p.type === PickType.SINGLE &&
          (kindOfCode(p.code) === CategoryKind.CT || kindOfCode(p.code) === CategoryKind.EX)
        ),
    );
    const finalPool = pool.length > 0 ? pool : all;
    if (finalPool.length === 0) return;
    const pick = finalPool[Math.floor(Math.random() * finalPool.length)];
    const picker = state.nextPicker ?? "A";
    state.picks.push({ by: picker, code: pick.code });
    enterPrep(pick.code);
    state.nextPicker = other(picker);
  }

  // =========================================================================
  // 动作：TB_FORCE
  // =========================================================================

  function forceTB(): void {
    if (!tbCode.value) return;
    state.picks.push({ by: state.nextPicker ?? "A", code: tbCode.value });
    enterPrep(tbCode.value);
  }

  // =========================================================================
  // 进入准备阶段：markPrep（IDLE/ROUND_END→PREP，会重置 pending）→ selectPick
  // =========================================================================

  function enterPrep(code: string, tags?: string[], retry?: number): void {
    // markPrep 仅在 IDLE/ROUND_END 可用（后端 begin_prep 守卫）；已在 PREP 则直接 selectPick。
    // 注意必须先 markPrep 再 selectPick：begin_prep 会清空 pending_pick_code。
    if (match.phase === MatchPhase.IDLE || match.phase === MatchPhase.ROUND_END) {
      match.markPrep();
    }
    match.selectPick(code, tags, retry);
    enterStage("PREP");
  }

  function manualStart(): void {
    match.manualStart();
  }

  // =========================================================================
  // 动作：战术暂停（经 !timer 续 60s；TB 准备阶段仅一次）
  // =========================================================================

  function useTimeout(side: Side): void {
    if (state.usedTimeout[side]) return; // 每人每场仅 1 次
    const tb = isTBPrep();
    if (tb && state.tbTimeoutUsed) return; // TB 准备阶段共享 1 次配额
    state.usedTimeout[side] = true;
    if (tb) state.tbTimeoutUsed = true;
    match.runCommand("!timer 60");
  }

  function isTBPrep(): boolean {
    return state.stage === "PREP" && !!match.pendingPickCode && match.pendingPickCode === tbCode.value;
  }

  // =========================================================================
  // 计时器（复用独立计数器 !timer）
  // =========================================================================

  function startPickTimer(): void {
    match.runCommand("!timer 60");
  }
  function startPrepTimer(): void {
    match.runCommand("!timer 120");
  }

  // =========================================================================
  // 重置
  // =========================================================================

  function resetDraft(): void {
    Object.assign(state, freshState());
    if (mappool.value) enterStage("ROLL");
  }

  /** 裁判「开始比赛」：激活 CREATED → RUNNING（选手随后可连入摇点）。单场冲突由后端拒绝。 */
  async function startMatch(): Promise<void> {
    if (!match.matchId || !auth.token) return;
    try {
      const s = await api.startMatch(match.matchId, auth.token);
      matchStatus.value = s.status;
    } catch (e) {
      ElMessage.error(e instanceof ApiError ? e.message : tr("toast.draftStartMatchFail"));
    }
  }

  /** 裁判「暂停比赛」：RUNNING → PAUSED，保留进度并释放选手占用（可分配到其他比赛）。 */
  async function pauseMatch(): Promise<void> {
    if (!match.matchId || !auth.token) return;
    try {
      const s = await api.pauseMatch(match.matchId, auth.token);
      matchStatus.value = s.status;
    } catch (e) {
      ElMessage.error(e instanceof ApiError ? e.message : tr("toast.draftPauseMatchFail"));
    }
  }

  /** 裁判「恢复比赛」：PAUSED → RUNNING；后端校验选手不在其他进行中比赛，冲突则原样展示后端错误。 */
  async function resumeMatch(): Promise<void> {
    if (!match.matchId || !auth.token) return;
    try {
      const s = await api.resumeMatch(match.matchId, auth.token);
      matchStatus.value = s.status;
    } catch (e) {
      ElMessage.error(e instanceof ApiError ? e.message : tr("toast.draftResumeMatchFail"));
    }
  }

  function $reset(): void {
    Object.assign(state, freshState());
    mappool.value = null;
    mappoolSource.value = "";
    loadError.value = "";
    banCount.value = 1;
    protectCount.value = 1;
    ctTagCount.value = 2;
    matchStatus.value = MatchStatus.CREATED;
  }

  // 暴露 token 便于组件按需载入
  const token = computed(() => auth.token);

  return {
    // 状态
    mappool,
    mappoolSource,
    loadError,
    banCount,
    protectCount,
    ctTagCount,
    matchStatus,
    needsStart,
    canPause,
    canResume,
    state,
    token,
    // 派生
    rollsSet,
    rollTie,
    highRoller,
    lowRoller,
    ordersDecided,
    ctTagChoices,
    tagBanDone,
    draftSlots,
    currentSlot,
    draftDone,
    tbCode,
    isDoubleMatchPoint,
    legalPicks,
    // 查询
    pickByCode,
    kindOfCode,
    needsRefereeRetry,
    isTaggedKind,
    codeLabel,
    mapStatus,
    validateChoice,
    nameOf,
    // 载入
    loadFromMatch,
    importMappoolJson,
    startMatch,
    pauseMatch,
    resumeMatch,
    // 动作
    setRolls,
    decidePickFirst,
    decideBanFirst,
    banTag,
    skipTagBan,
    chooseMap,
    undoLastAction,
    confirmPick,
    confirmPickWithOptions,
    randomPick,
    forceTB,
    useTimeout,
    startPickTimer,
    startPrepTimer,
    manualStart,
    resetDraft,
    $reset,
  };
});

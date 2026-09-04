/**
 * 比赛中央状态：WebSocket 连接、阶段/比分/选手实时状态、聊天、回合历史。
 *
 * 设计要点：
 * - 唯一权威实时通道是 WebSocket；REST（match_log / 聊天日志 / 回合明细）仅在
 *   （重）连接时拉取以重建状态，并用于「数据查看」。
 * - 裁判无权访问 /admin/matches，比赛元数据（赛制/图池选图编号/延迟）来自
 *   /logs/matches/{id}/match_log 的 initial_info；首回合开始前该日志尚不存在（404），
 *   此时图池编号未知，裁判需手动输入首个选图编号。
 */
import { defineStore } from "pinia";
import { computed, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";

import { api } from "@/api/client";
import {
  AttemptStatus,
  MatchPhase,
  MatchStatus,
  PlayerStatus,
  RoundVerdict,
  type Attempt,
  type ChatMessage,
  type LevelTime,
  type MatchLog,
  type RoundRecord,
  type SeatName,
} from "@/api/types";
import { send, type ServerMessage } from "@/ws/protocol";
import { ConnStatus, MatchSocket } from "@/ws/socket";
import { t as tr } from "@/locales";
import { useAuthStore } from "./auth";

/** 单方选手的实时展示状态 */
export interface PlayerLive {
  accountId: string;
  status: PlayerStatus;
  /** 座席 WS 是否在线（由 seat_state 广播维护；后端未实现该消息时恒为 true 兜底） */
  online: boolean;
  currentLevelIndex: number;
  completedLevels: LevelTime[];
  attempts: Attempt[];
  finalTotalMs: number | null;
  forfeited: boolean;
}

/** 统一聊天行（用户消息 / 系统消息） */
export interface ChatLine {
  id: string;
  kind: "user" | "system";
  senderName: string;
  seat?: SeatName;
  text: string;
  ts: string;
  systemKind?: string;
}

/** 某席最近一条 UTC 时间戳（receivedAt = 本地接收时刻） */
export interface UtcTimestamp {
  utcMs: number;
  receivedAt: number;
}

type Side = "A" | "B";

function freshPlayer(accountId = ""): PlayerLive {
  return {
    accountId,
    status: PlayerStatus.IN_GAME,
    online: true,
    currentLevelIndex: 0,
    completedLevels: [],
    attempts: [],
    finalTotalMs: null,
    forfeited: false,
  };
}

function seatToSide(seat: SeatName): Side {
  return seat === "PLAYER_B" ? "B" : "A";
}

/** 由已判定的回合记录重算累计比分 */
function computeWins(rounds: RoundRecord[]): { a: number; b: number } {
  let a = 0;
  let b = 0;
  for (const r of rounds) {
    if (!r.counted || r.verdict == null) continue;
    if (r.verdict === RoundVerdict.A_WIN || r.verdict === RoundVerdict.B_DISCONNECT_LOSS) {
      a += 1;
    } else if (
      r.verdict === RoundVerdict.B_WIN ||
      r.verdict === RoundVerdict.A_DISCONNECT_LOSS
    ) {
      b += 1;
    }
  }
  return { a, b };
}

let liveSeq = 0;

export const useMatchStore = defineStore("match", () => {
  const auth = useAuthStore();

  /**
   * 连接/加载世代号。每次切场或重置都会递增；所有异步 REST 重建（match detail、
   * match_log、回合明细、聊天）都在写回前校验世代号 + 当前 matchId，避免上一场
   * 的迟到响应把当前场数据覆盖成错乱。
   */
  let loadEpoch = 0;

  function isCurrentSession(epoch: number, sid: string): boolean {
    return epoch === loadEpoch && matchId.value === sid;
  }

  // --- 连接 ---
  const connStatus = ref<ConnStatus>("idle");
  const matchId = ref<string | null>(null);
  const seat = ref<SeatName | null>(null);
  const authErrorMessage = ref("");

  // --- 比赛元数据（来自 match_log.initial_info，可能尚未就绪）---
  const matchName = ref("");
  /** 比赛状态（来自 /me/matches/{id}；已结束比赛进入只读查看用） */
  const matchStatus = ref<MatchStatus | null>(null);
  const boFormat = ref(0);
  const winThreshold = ref(0);
  const scoringMethodName = ref<string>("");
  const countdownDelay = ref(5);
  const pickCodes = ref<string[]>([]);
  /** code → 已知展示信息（随回合明细/广播逐步补全） */
  const pickInfo = reactive<Record<string, { name?: string; category?: string; type?: number }>>({});

  // --- 实时阶段 ---
  const phase = ref<MatchPhase>(MatchPhase.IDLE);
  const currentRoundId = ref<string | null>(null);
  const pendingPickCode = ref<string | null>(null);
  /** 本次 pick 已提交的词条（CT/EX/CP；选图 → 回合开始之间展示用；服务端 error 不清空） */
  const pendingTags = ref<string[]>([]);
  /** 本次 pick 裁判指定的重试次数（CT/EX 单关；与 pendingTags 同生命周期） */
  const pendingRetry = ref<number | null>(null);
  const currentPick = ref<{ code: string; name: string } | null>(null);
  const countdown = ref<{ remaining: number; source: "auto" | "manual" } | null>(null);

  // --- 准备状态 ---
  const aReady = ref(false);
  const bReady = ref(false);
  /** 双方预载状态（preload_state 广播；absent = 从未上报/无预载） */
  const aPreload = ref<"absent" | "in_progress" | "done" | "failed" | "na">("absent");
  const bPreload = ref<"absent" | "in_progress" | "done" | "failed" | "na">("absent");

  // --- 双方实时状态 ---
  const players = reactive<{ A: PlayerLive; B: PlayerLive }>({
    A: freshPlayer(),
    B: freshPlayer(),
  });
  // 双席最近一条 UTC 时间戳（裁判侧时钟同步/监控用；连接级遥测，不随回合清空）
  const utcA = ref<UtcTimestamp | null>(null);
  const utcB = ref<UtcTimestamp | null>(null);

  // --- 比分 ---
  const winsA = ref(0);
  const winsB = ref(0);
  const matchWinner = ref<"A" | "B" | null>(null);

  // --- 回合历史（数据查看）---
  const roundsCache = ref<RoundRecord[]>([]);
  const historyLoading = ref(false);

  // --- 聊天 ---
  const messages = ref<ChatLine[]>([]);
  const knownIds = new Set<string>();
  const chatInput = ref("");

  // --- 独立倒计时器 ---
  const counterRemaining = ref<number | null>(null);

  let socket: MatchSocket | null = null;

  // =========================================================================
  // 计算属性
  // =========================================================================

  const metaReady = computed(() => !!matchName.value || pickCodes.value.length > 0);
  const bothReady = computed(() => aReady.value && bReady.value);
  /** 存在预载未完的席位（手动开始确认提示用） */
  const preloadIncomplete = computed(
    () => aPreload.value === "in_progress" || bPreload.value === "in_progress",
  );
  const canMarkPrep = computed(
    () => phase.value === MatchPhase.IDLE || phase.value === MatchPhase.ROUND_END,
  );
  const canManualStart = computed(() => phase.value === MatchPhase.PREP);
  const canVerdict = computed(
    () => phase.value === MatchPhase.ROUND_JUDGING && !!currentRoundId.value,
  );
  const matchEnded = computed(
    () =>
      phase.value === MatchPhase.MATCH_END || matchStatus.value === MatchStatus.ENDED,
  );
  /** 胜负已定：某方达到取胜分数（达阈值后比赛不自动结束，等裁判手动收尾） */
  const decidedWinner = computed<"A" | "B" | null>(() => {
    if (winThreshold.value <= 0) return null;
    if (winsA.value >= winThreshold.value) return "A";
    if (winsB.value >= winThreshold.value) return "B";
    return null;
  });
  const winnerDecided = computed(() => decidedWinner.value !== null);

  const pickList = computed(() =>
    pickCodes.value.map((code) => ({ code, ...(pickInfo[code] ?? {}) })),
  );

  const playerNames = reactive<{ A: string; B: string }>({ A: "", B: "" });

  /** 当前方实时成绩（仅展示用，依据 live 状态本地计算） */
  const liveScore = computed<{ A: number | null; B: number | null }>(() => {
    return { A: scoreOf(players.A), B: scoreOf(players.B) };
  });

  function scoreOf(p: PlayerLive): number | null {
    if (p.forfeited) return null;
    if (p.finalTotalMs != null) return p.finalTotalMs;
    // 多关：已完成关卡之和
    if (p.completedLevels.length > 0) {
      return p.completedLevels.reduce((s, l) => s + l.time_ms, 0);
    }
    // 单关：按本场计分方式对有效尝试取最快/平均（与后端 scoring.single_score 一致）
    const valid = p.attempts
      .filter((a) => a.status === AttemptStatus.VALID && a.time_ms != null)
      .map((a) => a.time_ms as number);
    if (valid.length === 0) return null;
    return scoringMethodName.value === "AVERAGE"
      ? Math.floor(valid.reduce((s, v) => s + v, 0) / valid.length)
      : Math.min(...valid);
  }

  // =========================================================================
  // 连接生命周期
  // =========================================================================

  function connect(requestedMatchId?: string): void {
    if (!auth.token) return;
    // 每次建立连接都视为一个全新会话：让上一连接尚未完成的 REST 回填全部失效。
    loadEpoch += 1;
    const target = requestedMatchId ?? null;
    // 切到另一场比赛（或从已清空状态重新建立连接）前先清掉上一场残留数据，
    // 避免旧数据在 auth_ok/REST 回来前短暂显示，也避免旧异步请求写回新场。
    if (target !== matchId.value) {
      $reset();
    }
    authErrorMessage.value = "";
    if (!socket) {
      socket = new MatchSocket();
      socket.onMessage = handleMessage;
      socket.onStatusChange = (s) => {
        connStatus.value = s;
        // 被同账号新窗口顶掉（exclusive 接管）：弹窗告知；确认可反手接管回来
        if (s === "displaced") void promptDisplaced(() => connect(lastMatchId()));
      };
    }
    // exclusive：独占裁判身份（账号+比赛）——本窗口顶掉旧窗口，也接受被新窗口顶掉
    socket.connect(auth.token, "REFEREE", requestedMatchId, true);
  }

  /** 当前执裁比赛 id：优先 auth_ok 回填的 matchId，兜底连接时传入的选场参数 */
  function lastMatchId(): string | undefined {
    return matchId.value || undefined;
  }

  /** 「已被其他窗口接管」弹窗：确认=重新接管（顶掉对方），关闭=留在本页不再重连 */
  async function promptDisplaced(retake: () => void): Promise<void> {
    try {
      await ElMessageBox.alert(tr("conn.displacedMsg"), tr("conn.displacedTitle"), {
        type: "warning",
        confirmButtonText: tr("conn.retakeBtn"),
      });
      retake();
    } catch {
      // 右上角关闭/ESC：留在本页（socket 已终态停止重连，可手动刷新恢复）
    }
  }

  function disconnect(): void {
    socket?.disconnect();
  }

  // =========================================================================
  // 服务端消息分发
  // =========================================================================

  function handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case "auth_ok":
        matchId.value = msg.match_id;
        seat.value = msg.seat;
        if (msg.match_name) matchName.value = msg.match_name;
        // 双方选手名：auth_ok 即带（后端已补），连入即有
        if (msg.player_a_name) playerNames.A = msg.player_a_name;
        if (msg.player_b_name) playerNames.B = msg.player_b_name;
        authErrorMessage.value = "";
        // 新连接/换场先清旧 UTC 遥测，随后服务端握手会补发当前双方最近值
        utcA.value = null;
        utcB.value = null;
        void loadMatchDetail();
        void loadHistory();
        break;
      case "auth_error":
        authErrorMessage.value = msg.msg || tr("toast.matchAuthFailed");
        socket?.disconnect();
        break;
      case "ready_state":
        aReady.value = msg.a_ready;
        bReady.value = msg.b_ready;
        break;
      case "preload_state":
        aPreload.value = msg.a_status;
        bPreload.value = msg.b_status;
        break;
      case "seat_state":
        if (msg.seat === "PLAYER_A" || msg.seat === "PLAYER_B") {
          players[seatToSide(msg.seat)].online = msg.online;
        }
        break;
      case "phase_change":
        onPhaseChange(msg.phase, msg.round_id ?? null);
        break;
      case "countdown_tick":
        countdown.value = { remaining: msg.remaining_secs, source: msg.source };
        break;
      case "countdown_abort":
        countdown.value = null;
        break;
      case "round_started_broadcast":
        currentRoundId.value = msg.round_id;
        currentPick.value = { code: msg.pick_code, name: msg.pick_name };
        enrichPick(msg.pick_code, { name: msg.pick_name });
        resetPlayersForNewRound();
        break;
      case "player_status":
        applyPlayerStatus(msg.seat, msg);
        break;
      case "level_time_update":
        // player_status 会随后带全量状态；此处仅作最小更新兜底
        applyLevelTimeUpdate(msg.seat, msg);
        break;
      case "utc_timestamp": {
        // 选手 UTC 时间戳：连接级遥测，按席覆盖最近一条（服务端已按席暂存，
        // 晚连握手里也会先补发）。用于裁判侧时钟同步/监控展示。
        const sample: UtcTimestamp = {
          utcMs: msg.utc_ms,
          receivedAt: Date.now(),
        };
        if (msg.seat === "PLAYER_A") utcA.value = sample;
        else if (msg.seat === "PLAYER_B") utcB.value = sample;
        break;
      }
      case "round_result":
        applyRoundResult(msg.round_id, msg.verdict, msg.score_a_ms ?? null, msg.score_b_ms ?? null);
        break;
      case "cumulative_score":
        winsA.value = msg.wins_a;
        winsB.value = msg.wins_b;
        if (winThreshold.value === 0) winThreshold.value = msg.threshold;
        break;
      case "match_end":
        matchWinner.value = msg.winner;
        break;
      case "counter_state":
        counterRemaining.value = msg.remaining_secs ?? null;
        break;
      case "counter_alert":
        counterRemaining.value = msg.remaining_secs;
        break;
      case "verdict_edit":
        applyVerdictEdit(msg.round_id, msg.old_verdict, msg.new_verdict);
        break;
      case "chat":
        pushChat({
          id: `live-${liveSeq++}`,
          kind: "user",
          senderName: msg.sender_name,
          seat: msg.seat,
          text: msg.text,
          ts: msg.ts,
        });
        rememberPlayerName(msg.seat, msg.sender_name);
        break;
      case "system":
        pushChat({
          id: `live-${liveSeq++}`,
          kind: "system",
          senderName: msg.sender ?? "Twilight",
          text: msg.text,
          ts: msg.ts,
          systemKind: msg.kind,
        });
        break;
      case "error":
        ElMessage.error(tr("toast.matchWsError", { code: msg.code, msg: msg.msg }));
        break;
      default:
        break;
    }
  }

  function onPhaseChange(newPhase: MatchPhase, roundId: string | null): void {
    phase.value = newPhase;
    if (roundId) currentRoundId.value = roundId;
    if (newPhase === MatchPhase.PREP) {
      // 进入准备阶段：清掉倒计时与双方实时状态，准备新一回合
      countdown.value = null;
      resetPlayersForNewRound();
      if (roundId && currentPick.value) {
        // 平局重赛：服务端已沿用同一选图，本地继承之（词条集合亦由服务端沿用）
        pendingPickCode.value = currentPick.value.code;
      } else {
        // 全新准备阶段：清掉上一回合的选图与项目信息
        pendingPickCode.value = null;
        pendingTags.value = [];
        pendingRetry.value = null;
        currentPick.value = null;
      }
    }
    if (newPhase === MatchPhase.IN_ROUND) {
      countdown.value = null;
    }
    if (newPhase === MatchPhase.IDLE) {
      currentPick.value = null;
    }
  }

  function resetPlayersForNewRound(): void {
    players.A = { ...freshPlayer(players.A.accountId), online: players.A.online };
    players.B = { ...freshPlayer(players.B.accountId), online: players.B.online };
  }

  function applyPlayerStatus(seatName: SeatName, m: ServerMessage): void {
    if (m.type !== "player_status") return;
    const side = seatToSide(seatName);
    players[side] = {
      accountId: m.account_id,
      status: m.status,
      online: true, // 能收到该消息说明该选手连接活跃
      currentLevelIndex: m.current_level_index,
      completedLevels: [...m.completed_levels],
      attempts: [...m.attempts],
      finalTotalMs: null,
      forfeited: m.status === PlayerStatus.FORFEITED,
    };
  }

  function applyLevelTimeUpdate(seatName: SeatName, m: ServerMessage): void {
    if (m.type !== "level_time_update") return;
    const side = seatToSide(seatName);
    const p = players[side];
    p.accountId = m.account_id;
    p.currentLevelIndex = Math.max(p.currentLevelIndex, m.level_index + 1);
    if (m.total_ms != null) p.finalTotalMs = m.total_ms;
    // 多关：按 level_index upsert
    const idx = p.completedLevels.findIndex((l) => l.level_index === m.level_index);
    const entry: LevelTime = {
      level_index: m.level_index,
      time_ms: m.this_level_ms,
      total_ms: m.total_ms ?? null,
    };
    if (idx >= 0) p.completedLevels[idx] = entry;
    else p.completedLevels.push(entry);
  }

  function applyRoundResult(
    roundId: string,
    verdict: RoundVerdict,
    scoreA: number | null,
    scoreB: number | null,
  ): void {
    const r = roundsCache.value.find((x) => x.id === roundId);
    if (r) {
      r.verdict = verdict;
      r.score_a_ms = scoreA;
      r.score_b_ms = scoreB;
      r.counted = verdict !== RoundVerdict.TIE_REMATCH;
    }
    if (verdict === RoundVerdict.TIE_REMATCH) {
      ElMessage.warning(tr("toast.matchTieRematchWarn"));
    }
  }

  function applyVerdictEdit(
    roundId: string,
    _oldVerdict: RoundVerdict,
    newVerdict: RoundVerdict,
  ): void {
    const r = roundsCache.value.find((x) => x.id === roundId);
    if (r) {
      r.verdict = newVerdict;
      r.counted = newVerdict !== RoundVerdict.TIE_REMATCH;
    }
    // 累计比分由随后的 cumulative_score 广播权威更新
  }

  function rememberPlayerName(seatName: SeatName, name: string): void {
    // playerNames 以比赛详情的用户名为权威；聊天展示名仅作缺失兜底，不覆盖。
    if (seatName === "PLAYER_A") {
      if (!playerNames.A) playerNames.A = name;
    } else if (seatName === "PLAYER_B") {
      if (!playerNames.B) playerNames.B = name;
    }
  }

  function enrichPick(code: string, info: { name?: string; category?: string; type?: number }): void {
    const existing = pickInfo[code] ?? {};
    pickInfo[code] = {
      ...existing,
      ...(info.name ? { name: info.name } : {}),
      ...(info.category ? { category: info.category } : {}),
      ...(info.type != null ? { type: info.type } : {}),
    };
  }

  // =========================================================================
  // 聊天
  // =========================================================================

  function pushChat(line: ChatLine): void {
    if (knownIds.has(line.id)) return;
    knownIds.add(line.id);
    messages.value.push(line);
  }

  function ingestChatLog(log: ChatMessage[]): void {
    if (log.length === 0) return;
    if (messages.value.length === 0) {
      messages.value = log.map(toLine);
      for (const m of log) knownIds.add(m.id);
    } else {
      for (const m of log) {
        if (!knownIds.has(m.id)) {
          knownIds.add(m.id);
          messages.value.push(toLine(m));
        }
      }
    }
  }

  function toLine(m: ChatMessage): ChatLine {
    return {
      id: m.id,
      kind: m.is_system ? "system" : "user",
      senderName: m.sender_name, // 系统消息为 "Twilight"（旧记录可能是 "System"，按存储值展示）
      text: m.text,
      ts: m.ts,
      systemKind: m.is_system ? "info" : undefined,
    };
  }

  // =========================================================================
  // （重）连接后拉取历史，重建元数据/比分/图池/聊天
  // =========================================================================

  /**
   * 拉取比赛详情（REST /me/matches/{id}），立即填充双方账号 id、用户名与元数据。
   * match_log 首回合后才存在，此接口比赛一创建即可用，故选手标识不必等开赛。
   * playerNames 存选手用户名（username）作为展示用名；聊天捕获的展示名仅在
   * 用户名缺失时兜底，避免覆盖。
   * 失败静默（loadHistory/WS 后续仍会补）。
   */
  async function loadMatchDetail(): Promise<void> {
    if (!matchId.value || !auth.token) return;
    const epoch = loadEpoch;
    const sid = matchId.value;
    try {
      const m = await api.getMyMatch(sid, auth.token);
      if (!isCurrentSession(epoch, sid)) return;
      if (m.player_a_id) players.A.accountId = m.player_a_id;
      if (m.player_b_id) players.B.accountId = m.player_b_id;
      if (m.player_a_username) playerNames.A = m.player_a_username;
      if (m.player_b_username) playerNames.B = m.player_b_username;
      if (m.bo_format) boFormat.value = m.bo_format;
      if (m.win_threshold) winThreshold.value = m.win_threshold;
      matchStatus.value = m.status;
    } catch {
      // 纯裁判无权或网络失败：保持空，由 match_log/WS 兜底
    }
  }

  async function loadHistory(): Promise<void> {
    if (!matchId.value || !auth.token) return;
    const epoch = loadEpoch;
    const sid = matchId.value;
    historyLoading.value = true;
    try {
      // match_log + 全部回合明细 + 比分 + 图池元数据
      await refreshRounds();
      if (!isCurrentSession(epoch, sid)) return;
      try {
        const chat = await api.getChatLog(sid, auth.token);
        if (!isCurrentSession(epoch, sid)) return;
        ingestChatLog(chat);
      } catch {
        // 聊天日志拉取失败不阻断
      }
    } finally {
      if (isCurrentSession(epoch, sid)) historyLoading.value = false;
    }
  }

  function applyInitialInfo(log: MatchLog): void {
    const info = log.initial_info ?? {};
    if (info.name) matchName.value = info.name;
    if (info.bo_format) boFormat.value = info.bo_format;
    if (info.win_threshold) winThreshold.value = info.win_threshold;
    if (info.scoring_method) scoringMethodName.value = info.scoring_method;
    if (info.start_countdown_delay != null) {
      countdownDelay.value = info.start_countdown_delay;
    }
    if (Array.isArray(info.mappool)) {
      pickCodes.value = info.mappool.slice();
    }
    if (info.player_a_id) players.A.accountId = info.player_a_id;
    if (info.player_b_id) players.B.accountId = info.player_b_id;
  }

  /** 拉取全部回合明细，重建比分/图池信息/历史缓存 */
  async function refreshRounds(): Promise<void> {
    if (!matchId.value || !auth.token) return;
    const epoch = loadEpoch;
    const sid = matchId.value;
    // 先取 match_log：拿到 initial_info（元数据/图池编号）与回合总数
    let count = roundsCache.value.length;
    try {
      const log = await api.getMatchLog(sid, auth.token);
      if (!isCurrentSession(epoch, sid)) return;
      applyInitialInfo(log);
      count = Math.max(count, log.round_ids.length);
      if (log.final_result?.winner) {
        matchWinner.value = log.final_result.winner;
      }
    } catch {
      // 首回合开始前日志尚不存在（404）：保持已有缓存，无回合可拉
    }
    if (!isCurrentSession(epoch, sid) || count === 0) return;
    const list: RoundRecord[] = [];
    for (let i = 1; i <= count; i++) {
      try {
        const r = await api.getRoundDetail(sid, i, auth.token);
        if (!isCurrentSession(epoch, sid)) return;
        list.push(r);
      } catch {
        break; // 回合不存在即到边界
      }
    }
    if (!isCurrentSession(epoch, sid) || list.length === 0) return;
    list.sort((a, b) => a.round_no - b.round_no);
    roundsCache.value = list;
    // 丰富图池展示信息
    for (const r of list) {
      const p = r.pick_snapshot;
      enrichPick(p.code, {
        name: p.name,
        category: p.category ?? undefined,
        type: p.type,
      });
    }
    // 用历史重算比分（与 cumulative_score 广播同源，结果一致）
    const w = computeWins(list);
    winsA.value = w.a;
    winsB.value = w.b;
  }

  // =========================================================================
  // 裁判动作（客户端 → 服务端）
  // =========================================================================

  function sendChat(text: string): void {
    const t = text.trim();
    if (!t || !socket) return;
    if (socket.send(send.chat(t))) {
      chatInput.value = "";
    }
  }

  function markPrep(): void {
    socket?.send(send.refereeMarkPrep());
  }

  function selectPick(code: string, tags?: string[], retryCount?: number): void {
    const c = code.trim();
    if (!c) return;
    // 仅 CT/EX/CP 选图携带词条、CT/EX 单关携带重试次数；
    // 发送失败（含服务端校验 error）时保留原选择，不清空
    const sendTags = tags && tags.length > 0 ? tags : undefined;
    const sendRetry = retryCount != null ? retryCount : undefined;
    if (socket?.send(send.refereeSelectPick(c, sendTags, sendRetry))) {
      pendingPickCode.value = c;
      pendingTags.value = sendTags ?? [];
      pendingRetry.value = sendRetry ?? null;
    }
  }

  /** 取消当前尚未开始的选图（仅改本地 pending，服务端仍以之后的新选图覆盖）。 */
  function clearPendingPick(): void {
    pendingPickCode.value = null;
    pendingTags.value = [];
    pendingRetry.value = null;
  }

  function manualStart(): void {
    socket?.send(send.refereeManualStart());
  }

  /** 上报 ban/pick 草稿状态（后端转发给导播叠加层） */
  function sendDraft(state: Record<string, unknown>): void {
    socket?.send(send.draftSync(state));
  }

  function doVerdict(verdict: RoundVerdict): void {
    if (!currentRoundId.value) return;
    socket?.send(send.refereeVerdict(currentRoundId.value, verdict));
  }

  function editVerdict(roundId: string, newVerdict: RoundVerdict): void {
    socket?.send(send.refereeEditVerdict(roundId, newVerdict));
  }

  function terminateRound(reason: string): void {
    if (!currentRoundId.value) return;
    socket?.send(send.refereeTerminateRound(currentRoundId.value, reason));
  }

  /** 手动结束比赛（后端按比分判定胜方并踢出选手；需已达到取胜分数） */
  function endMatch(): void {
    socket?.send(send.refereeEndMatch());
  }

  /** 通用命令快捷方式（服务端解析 `!` 开头聊天） */
  function runCommand(cmd: string): void {
    const text = cmd.startsWith("!") ? cmd : `!${cmd}`;
    sendChat(text);
  }

  // =========================================================================
  // 重置（登出/换号）
  // =========================================================================

  function $reset(): void {
    loadEpoch += 1;
    disconnect();
    socket = null;
    connStatus.value = "idle";
    matchId.value = null;
    seat.value = null;
    authErrorMessage.value = "";
    matchName.value = "";
    matchStatus.value = null;
    boFormat.value = 0;
    winThreshold.value = 0;
    scoringMethodName.value = "";
    countdownDelay.value = 5;
    pickCodes.value = [];
    for (const k of Object.keys(pickInfo)) delete pickInfo[k];
    phase.value = MatchPhase.IDLE;
    currentRoundId.value = null;
    pendingPickCode.value = null;
    pendingTags.value = [];
    pendingRetry.value = null;
    currentPick.value = null;
    countdown.value = null;
    aReady.value = false;
    bReady.value = false;
    aPreload.value = "absent";
    bPreload.value = "absent";
    players.A = freshPlayer();
    players.B = freshPlayer();
    utcA.value = null;
    utcB.value = null;
    winsA.value = 0;
    winsB.value = 0;
    matchWinner.value = null;
    roundsCache.value = [];
    historyLoading.value = false;
    messages.value = [];
    knownIds.clear();
    chatInput.value = "";
    counterRemaining.value = null;
    playerNames.A = "";
    playerNames.B = "";
  }

  return {
    // 状态
    connStatus,
    matchId,
    seat,
    authErrorMessage,
    matchName,
    matchStatus,
    boFormat,
    winThreshold,
    scoringMethodName,
    countdownDelay,
    pickCodes,
    pickInfo,
    phase,
    currentRoundId,
    pendingPickCode,
    pendingTags,
    pendingRetry,
    currentPick,
    countdown,
    aReady,
    bReady,
    aPreload,
    bPreload,
    players,
    utcA,
    utcB,
    playerNames,
    winsA,
    winsB,
    matchWinner,
    roundsCache,
    historyLoading,
    messages,
    chatInput,
    counterRemaining,
    // 计算
    metaReady,
    bothReady,
    preloadIncomplete,
    canMarkPrep,
    canManualStart,
    canVerdict,
    matchEnded,
    winnerDecided,
    decidedWinner,
    pickList,
    liveScore,
    // 连接
    connect,
    disconnect,
    // 裁判动作
    sendChat,
    markPrep,
    selectPick,
    clearPendingPick,
    manualStart,
    sendDraft,
    doVerdict,
    editVerdict,
    terminateRound,
    endMatch,
    runCommand,
    refreshRounds,
    $reset,
  };
});

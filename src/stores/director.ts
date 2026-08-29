/**
 * 导播端状态：控制台与 OBS 叠加层共用。
 *
 * 复用 MatchSocket 收后端广播（导播连接 WS 后服务端按账号解析 seat=DIRECTOR
 * 自动订阅，`director_subscribe` 实为 no-op，导播只读）。connect(token) 接受
 * 任意 token——控制台用 auth.token，叠加层用 URL ?token=。
 *
 * 选手展示名从聊天消息捕获（未发言前以「选手A / 选手B」占位）；比赛元数据
 * （赛制 / 延迟）在 auth_ok 后拉 match_log 补全（首回合前日志不存在则忽略）。
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";

import { api } from "@/api/client";
import {
  MatchPhase,
  MatchStatus as MS,
  PickType,
  PlayerStatus,
  type Attempt,
  type LevelTime,
  type MatchPhase as MP,
  type Pick,
  type PickType as PT,
  type PlayerStatus as PS,
  type RoundVerdict,
  type SeatName,
} from "@/api/types";
import type { ServerMessage } from "@/ws/protocol";
import { send } from "@/ws/protocol";
import { ConnStatus, MatchSocket } from "@/ws/socket";
import { useAuthStore } from "./auth";
import {
  mergeStoredConfig,
  type DirectorConfig,
} from "@/scenes/composables/useDirectorConfig";
import { t as tr } from "@/locales";

export interface PlayerLive {
  status: PS;
  currentLevelIndex: number;
  completedLevels: LevelTime[];
  attempts: Attempt[];
}

export interface DirectorRound {
  roundId: string;
  pick: Pick;
  collection: { raw: Record<string, unknown> };
  type: PT;
}

interface LogLine {
  ts: string;
  kind: string;
  text: string;
}

/** 场景页聊天行（结构化，供导播场景按身份着色渲染，样式对齐管理端日志） */
export interface DirectorChatLine {
  id: number;
  ts: string;
  kind: "chat" | "system";
  seat: SeatName | "";
  sender: string;
  text: string;
}

/** 某席最近一条 live_time 实时计时读数（receivedAt = 本地接收时刻） */
export interface LiveTime {
  levelIndex: number;
  /** 回合累计毫秒（与官方计分同一条时间线） */
  totalMs: number;
  /** 当前分段进行时长（自该关加载沿起算） */
  segmentMs: number;
  /** 现实/墙钟累计（毫秒）；提供方支持时存在 */
  realTimeMs?: number | null;
  receivedAt: number;
}

const MAX_LOG = 200;

function clock(): string {
  return new Date().toLocaleTimeString("zh-CN", { hour12: false });
}

function freshPlayer(): PlayerLive {
  return {
    status: PlayerStatus.IN_GAME,
    currentLevelIndex: 0,
    completedLevels: [],
    attempts: [],
  };
}

export const useDirectorStore = defineStore("director", () => {
  const auth = useAuthStore();
  const socket = new MatchSocket();

  const tokenRef = ref("");
  const connStatus = ref<ConnStatus>("idle");
  const seat = ref<SeatName | "">("");
  const matchId = ref("");
  const displayName = ref("");
  const authError = ref("");

  const phase = ref<MP>(MatchPhase.IDLE);
  const aReady = ref(false);
  const bReady = ref(false);
  /** 双方选手 WS 在线（seat_state 广播维护，连接时后端补发全量快照；默认 true 兜底） */
  const aOnline = ref(true);
  const bOnline = ref(true);
  /** 双方预载状态（preload_state 广播；absent = 从未上报/无预载） */
  const aPreload = ref<"absent" | "in_progress" | "done" | "failed" | "na">("absent");
  const bPreload = ref<"absent" | "in_progress" | "done" | "failed" | "na">("absent");
  const countdownRemaining = ref<number | null>(null);
  const countdownSource = ref<"auto" | "manual" | null>(null);

  const currentRound = ref<DirectorRound | null>(null);
  const playerA = ref<PlayerLive>(freshPlayer());
  const playerB = ref<PlayerLive>(freshPlayer());

  const winsA = ref(0);
  const winsB = ref(0);
  const threshold = ref(0);
  const matchWinner = ref<"A" | "B" | null>(null);
  const lastResult = ref<{
    verdict: RoundVerdict;
    scoreA: number | null;
    scoreB: number | null;
  } | null>(null);

  const nameA = ref(tr("seat.a"));
  const nameB = ref(tr("seat.b"));

  const matchName = ref("");
  /** 比赛状态（MatchStatus；首回合前 REST 拉到，Coming Soon 场景兜底显示用） */
  const matchStatus = ref<MS | null>(null);
  const boFormat = ref(0);
  const winThreshold = ref(0);
  const scoringMethodName = ref<"FASTEST" | "AVERAGE" | "">("");
  const countdownDelay = ref<number | null>(null);
  /** 所属赛事 id（独立比赛为空）；赛程图场景页链接用 */
  const tournamentId = ref("");
  /** 双方选手的 speedrun.com 账号绑定（REST getMyMatch 拉取；categoryinfo 场景高亮用） */
  const speedrunA = ref<string | null>(null);
  const speedrunB = ref<string | null>(null);
  const metaReady = ref(false);

  const messages = ref<LogLine[]>([]);

  /** 聊天行（时间正序追加；仅实时 WS 流，无历史回填——场景页接入即从当下开始） */
  const chatLines = ref<DirectorChatLine[]>([]);
  let chatSeq = 0;
  function pushChatLine(line: Omit<DirectorChatLine, "id">): void {
    chatLines.value.push({ id: ++chatSeq, ...line });
    if (chatLines.value.length > MAX_LOG) {
      chatLines.value.splice(0, chatLines.value.length - MAX_LOG);
    }
  }

  /** ban/pick 草稿状态（裁判端权威上报、后端转发；供叠加层渲染 ban/pick 动画） */
  const draft = ref<Record<string, unknown> | null>(null);

  /**
   * 最近一条 subsegment 实时时间差（仅 MULTI 回合进行中产生，需求见
   * ignored/需求-subsegment实时时间差追踪与前端接入.md），已归一为有符号
   * 偏差（毫秒）：正 = B 落后（偏差条游标向 B 侧），负 = A 落后。
   * 回合级内存态：服务端回合结束即清空且断线不补发，前端在离开 IN_ROUND /
   * 新回合时同步清空；长直道可能长时间无新 gap（≠ 掉线），最近一条照常显示。
   */
  const subsegmentGap = ref<number | null>(null);

  /**
   * 双席最近一条 live_time 实时计时（每秒上报，仅裁判/导播收到，需求见
   * ignored/需求-live_time实时计时中转.md）。消息无时间戳，receivedAt 记本地
   * 接收时刻供场景页判断陈旧度。回合级内存态：与 subsegmentGap 同生命周期
   * （服务端回合结束即清空且断线不补发，仅握手时补发最近一条）。
   */
  const liveTimeA = ref<LiveTime | null>(null);
  const liveTimeB = ref<LiveTime | null>(null);

  socket.onStatusChange = (s) => {
    connStatus.value = s;
  };
  socket.onMessage = (msg) => handle(msg);

  const isMulti = computed(() => currentRound.value?.type === PickType.MULTI);
  /** 已结束比赛：导播仅可查看；除场景切换（纯舞台展示控制）外，倒计时 / 配置广播等操作全部锁定。 */
  const matchEnded = computed(
    () => matchStatus.value === MS.ENDED || phase.value === MatchPhase.MATCH_END,
  );

  function log(kind: string, text: string, ts?: string): void {
    messages.value.unshift({ ts: ts ?? clock(), kind, text });
    if (messages.value.length > MAX_LOG) messages.value.length = MAX_LOG;
  }

  function applyPlayer(s: SeatName, live: PlayerLive): void {
    if (s === "PLAYER_A") playerA.value = live;
    else if (s === "PLAYER_B") playerB.value = live;
  }

  /** 回合级实时遥测清空（subsegment 差距 + 双席 live_time，随回合边界重置） */
  function clearRoundTelemetry(): void {
    subsegmentGap.value = null;
    liveTimeA.value = null;
    liveTimeB.value = null;
  }

  function handle(msg: ServerMessage): void {
    switch (msg.type) {
      case "auth_ok":
        seat.value = msg.seat;
        matchId.value = msg.match_id;
        displayName.value = msg.display_name;
        // 双方选手名：auth_ok 即带（后端已补），连入即有，不再依赖聊天捕获
        if (msg.player_a_name) nameA.value = msg.player_a_name;
        if (msg.player_b_name) nameB.value = msg.player_b_name;
        authError.value = "";
        void loadMeta();
        break;
      case "auth_error":
        authError.value = msg.msg;
        break;
      case "phase_change":
        // 离开 IN_ROUND：服务端已清空回合级 subsegment / live_time 数据，前端同步清掉
        if (phase.value === MatchPhase.IN_ROUND && msg.phase !== MatchPhase.IN_ROUND) {
          clearRoundTelemetry();
        }
        phase.value = msg.phase;
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
        if (msg.seat === "PLAYER_A") aOnline.value = msg.online;
        else if (msg.seat === "PLAYER_B") bOnline.value = msg.online;
        break;
      case "countdown_tick":
        countdownRemaining.value = msg.remaining_secs;
        countdownSource.value = msg.source;
        break;
      case "countdown_abort":
        countdownRemaining.value = null;
        countdownSource.value = null;
        break;
      case "pick_announced": {
        // 裁判选图确定（进入 PREP 前）即重置上一回合数据：场景计时 / 偏差条
        // 提前归零，并以预览 pick 提前切换多关 / 单关布局。
        // round_start 仍是权威（重复赋值幂等，届时补上真实 round_id）。
        currentRound.value = {
          roundId: "",
          pick: msg.pick,
          collection: msg.collection,
          type: msg.pick.type,
        };
        playerA.value = freshPlayer();
        playerB.value = freshPlayer();
        matchWinner.value = null;
        lastResult.value = null;
        clearRoundTelemetry();
        break;
      }
      case "round_start":
        currentRound.value = {
          roundId: msg.round_id,
          pick: msg.pick,
          collection: msg.collection,
          type: msg.pick.type,
        };
        playerA.value = freshPlayer();
        playerB.value = freshPlayer();
        matchWinner.value = null;
        lastResult.value = null;
        clearRoundTelemetry();
        break;
      case "player_status":
        applyPlayer(msg.seat, {
          status: msg.status,
          currentLevelIndex: msg.current_level_index,
          completedLevels: msg.completed_levels,
          attempts: msg.attempts,
        });
        break;
      case "subsegment_gap": {
        // 实时时间差：最近一条直接覆盖（双向 gap 交错时最新比较点即当前差距）。
        // 服务端只广播当前回合，此处再按 round_id 防御过期回合串扰（回合 id 未知
        // 时放行——中途接入尚未收到 round_start 也能立即显示）。
        const cur = currentRound.value?.roundId;
        if (cur && msg.round_id !== cur) break;
        subsegmentGap.value =
          // gap_ms >0 = 穿越方（hit_seat）落后 → 归一为偏差条口径「正 = B 落后」
          msg.hit_seat === "PLAYER_B" ? msg.gap_ms : -msg.gap_ms;
        break;
      }
      case "live_time": {
        // 双席实时计时（每秒）：按席暂存最近一条供场景页平滑外推走表，每条
        // 到达即重新锚定。同 subsegment_gap 按 round_id 防御过期回合串扰
        // （回合 id 未知时放行——中途接入尚未收到 round_start 也能立即对齐）。
        const cur = currentRound.value?.roundId;
        if (cur && msg.round_id !== cur) break;
        const sample: LiveTime = {
          levelIndex: msg.level_index,
          totalMs: msg.total_ms,
          segmentMs: msg.segment_ms,
          realTimeMs: msg.real_time_ms ?? null,
          receivedAt: Date.now(),
        };
        if (msg.seat === "PLAYER_A") liveTimeA.value = sample;
        else if (msg.seat === "PLAYER_B") liveTimeB.value = sample;
        break;
      }
      case "round_result":
        lastResult.value = {
          verdict: msg.verdict,
          scoreA: msg.score_a_ms ?? null,
          scoreB: msg.score_b_ms ?? null,
        };
        break;
      case "cumulative_score":
        winsA.value = msg.wins_a;
        winsB.value = msg.wins_b;
        threshold.value = msg.threshold;
        break;
      case "match_end":
        matchWinner.value = msg.winner;
        break;
      case "chat":
        if (msg.seat === "PLAYER_A") nameA.value = msg.sender_name;
        else if (msg.seat === "PLAYER_B") nameB.value = msg.sender_name;
        log("chat", `${msg.sender_name}：${msg.text}`, msg.ts);
        pushChatLine({ ts: msg.ts, kind: "chat", seat: msg.seat, sender: msg.sender_name, text: msg.text });
        break;
      case "system":
        log("system", msg.text, msg.ts);
        pushChatLine({ ts: msg.ts, kind: "system", seat: "", sender: msg.sender ?? "Twilight", text: msg.text });
        break;
      case "error":
        log("error", tr("log.errorLog", { code: msg.code, msg: msg.msg }));
        break;
      case "draft_state":
        draft.value = msg.state;
        break;
      case "director_cmd":
        // 导播控制台通过 WS 广播的指令（场景切换 / 倒计时操控 / 配置下发），
        // 以及服务端连接回放（state_sync：舞台/控制台晚打开也能对齐状态）
        if (msg.action === "state_sync") {
          applyStateSync(msg.payload ?? {});
        } else if (msg.action === "switch_scene") {
          currentSceneCmd.value = (msg.payload?.scene as string) ?? null;
        } else if (msg.action === "soon_set_target" && msg.payload?.target_ms) {
          soonCmdState.value.targetMs = msg.payload.target_ms as number;
        } else if (msg.action === "soon_start") {
          const s = soonCmdState.value;
          if (s.pausedAt !== null) {
            s.startedAt = (s.startedAt ?? 0) + (Date.now() - s.pausedAt);
            s.pausedAt = null;
          } else {
            s.startedAt = Date.now();
          }
        } else if (msg.action === "soon_pause") {
          const s = soonCmdState.value;
          if (s.startedAt !== null && s.pausedAt === null) s.pausedAt = Date.now();
        } else if (msg.action === "soon_reset") {
          soonCmdState.value = { targetMs: soonCmdState.value.targetMs, startedAt: null, pausedAt: null };
        } else if (msg.action === "config_update" && msg.payload?.config) {
          // 直播配置实时下发（控制台保存 → 舞台/其他控制台，后端排除发送者）：
          // 落库（舞台此刻可能不在比赛场景，挂载后 load 才能读到）+ 更新 ref
          // 供已挂载的 MatchScene / 控制台面板实时并入。
          const patch = msg.payload.config as Partial<DirectorConfig>;
          remoteConfig.value = patch;
          if (matchId.value) mergeStoredConfig(matchId.value, patch);
        }
        break;
      default:
        // level_time_update / counter_* / round_started_broadcast / verdict_edit
        // 已由 player_status / cumulative_score 等覆盖或与导播展示无关，忽略
        break;
    }
  }

  async function loadMeta(): Promise<void> {
    if (!matchId.value || !tokenRef.value) return;
    // 1) /me/matches/{id}：首回合前即可用（match_log 要首回合后才生成），
    //    尽早补比赛名/状态/赛事归属（Coming Soon 场景与舞台 URL 依赖），
    //    并提前回填 BO/胜点（顶栏比分指示器在首个判决前就有据可依）。
    try {
      const m = await api.getMyMatch(matchId.value, tokenRef.value);
      matchName.value = m.name || matchName.value;
      matchStatus.value = m.status;
      tournamentId.value = m.tournament_id || tournamentId.value;
      boFormat.value = m.bo_format || boFormat.value;
      winThreshold.value = m.win_threshold || winThreshold.value;
      speedrunA.value = m.player_a_speedrun ?? null;
      speedrunB.value = m.player_b_speedrun ?? null;
    } catch {
      // token 无权限等，忽略（下面 match_log 再试一次）
    }
    // 2) match_log：BO/胜点/计分制等（首回合前 404 忽略）。
    try {
      const doc = await api.getMatchLog(matchId.value, tokenRef.value);
      const info = doc.initial_info;
      matchName.value = info.name ?? "";
      boFormat.value = info.bo_format ?? 0;
      winThreshold.value = info.win_threshold ?? 0;
      scoringMethodName.value =
        (info.scoring_method as "FASTEST" | "AVERAGE" | undefined) ?? "";
      countdownDelay.value = info.start_countdown_delay ?? null;
      tournamentId.value = doc.tournament_id ?? "";
    } catch {
      // 首回合前 match_log 尚未生成（404），忽略
    }
    metaReady.value = true;
  }

  function connect(token: string, matchId?: string): void {
    tokenRef.value = token;
    socket.connect(token, "DIRECTOR", matchId);
  }

  function connectWithAuth(matchId?: string): void {
    if (auth.token) connect(auth.token, matchId);
  }

  function disconnect(): void {
    socket.disconnect();
  }

  // ---- 导播控制台 → 舞台 WS 广播指令 ----

  /** 当前场景指令（控制台发 → store 收 director_cmd 后更新；舞台/SoonScene 读此 ref） */
  const currentSceneCmd = ref<string | null>(null);
  /** Coming Soon 倒计时状态（同上，WS 广播同步） */
  interface SoonCmdState {
    targetMs: number;
    startedAt: number | null;
    pausedAt: number | null;
  }
  const soonCmdState = ref<SoonCmdState>({
    targetMs: 300_000,
    startedAt: null,
    pausedAt: null,
  });
  /** 最近一次 config_update 广播的配置（已同步落库；ref 供已挂载场景响应） */
  const remoteConfig = ref<Partial<DirectorConfig> | null>(null);

  /**
   * state_sync 回放（连接建立时服务端补发，后端 c58f0ad）：并入场景/倒计时/配置。
   * soon 时间戳是服务器毫秒，用 now_ms 折算本地偏移（跨机时钟不一时剩余时间仍准；
   * started_at 服务端已扣暂停时长，与本地 soonCmdState 语义一致）。
   * scene/config 为空表示该部分从未发过指令，保持现状不动。
   */
  function applyStateSync(p: Record<string, unknown>): void {
    if (typeof p.scene === "string" && p.scene) currentSceneCmd.value = p.scene;

    const soon = p.soon as
      | { target_ms?: number | null; started_at?: number | null; paused_at?: number | null; now_ms?: number }
      | undefined;
    if (soon && typeof soon.now_ms === "number") {
      const offset = Date.now() - soon.now_ms;
      soonCmdState.value = {
        targetMs:
          typeof soon.target_ms === "number"
            ? soon.target_ms
            : soonCmdState.value.targetMs,
        startedAt: typeof soon.started_at === "number" ? soon.started_at + offset : null,
        pausedAt: typeof soon.paused_at === "number" ? soon.paused_at + offset : null,
      };
    }

    const cfg = p.config as Partial<DirectorConfig> | undefined;
    if (cfg && Object.keys(cfg).length > 0) {
      remoteConfig.value = cfg;
      if (matchId.value) mergeStoredConfig(matchId.value, cfg);
    }
  }

  /**
   * 发送导演指令到后端，后端广播给同账号其他导播连接（OBS 舞台）。
   * 同时更新本地状态（控制台自身也是 director 连接，但后端广播 exclude sender）。
   */
  function sendDirectorCommand(
    action:
      | "switch_scene"
      | "soon_start"
      | "soon_pause"
      | "soon_reset"
      | "soon_set_target"
      | "config_update",
    payload?: Record<string, unknown>,
  ): boolean {
    // 已结束比赛仅锁定会改变比赛/直播配置的操作；场景切换只是舞台展示控制，
    // 仍应允许导播在结束后切换查看比赛详情 / 图池 / 赛程图等回放画面。
    if (matchEnded.value && action !== "switch_scene") return false;
    // 同步本地状态（config_update 无需：发送方本地已保存，后端广播排除发送者）
    if (action === "switch_scene") {
      currentSceneCmd.value = (payload?.scene as string) ?? null;
    } else if (action === "soon_set_target" && payload?.target_ms) {
      soonCmdState.value.targetMs = payload.target_ms as number;
    } else if (action === "soon_start") {
      const s = soonCmdState.value;
      if (s.pausedAt !== null) {
        // 继续：补偿暂停时长
        s.startedAt = (s.startedAt ?? 0) + (Date.now() - s.pausedAt);
        s.pausedAt = null;
      } else {
        s.startedAt = Date.now();
        s.pausedAt = null;
      }
    } else if (action === "soon_pause") {
      const s = soonCmdState.value;
      if (s.startedAt !== null && s.pausedAt === null) {
        s.pausedAt = Date.now();
      }
    } else if (action === "soon_reset") {
      soonCmdState.value = { targetMs: soonCmdState.value.targetMs, startedAt: null, pausedAt: null };
    }

    // 发 WS（可排队：连接未就绪时暂存，open 后按序补发，断线窗口点按钮不丢指令）
    return socket.sendQueued(send.directorCommand(action, payload));
  }

  function nameOf(side: "A" | "B"): string {
    return side === "A" ? nameA.value : nameB.value;
  }
  function playerOf(side: "A" | "B"): PlayerLive {
    return side === "A" ? playerA.value : playerB.value;
  }
  /** 某席最近一条 live_time 实时计时（无上报 / 回合外为 null） */
  function liveTimeOf(side: "A" | "B"): LiveTime | null {
    return side === "A" ? liveTimeA.value : liveTimeB.value;
  }

  /**
   * 场景独立入口页链接（stage.html / mappool.html 等，页面名不带斜杠）：
   * 带当前 token + 本场 match + 所属 tournament（赛程图 / 图池场景需）。
   */
  function scenePageUrl(page: string): string {
    if (!tokenRef.value) return "";
    const qs = [
      `token=${encodeURIComponent(tokenRef.value)}`,
      matchId.value ? `match=${encodeURIComponent(matchId.value)}` : "",
      tournamentId.value ? `tournament=${encodeURIComponent(tournamentId.value)}` : "",
    ]
      .filter(Boolean)
      .join("&");
    return `${globalThis.location.origin}/${page}?${qs}`;
  }

  /** 合并舞台链接：单 OBS 浏览器源承载全部场景，导播控制台切场景 */
  const stageUrl = computed(() => scenePageUrl("stage.html"));

  return {
    // 连接
    connStatus,
    seat,
    matchId,
    displayName,
    authError,
    // 比赛
    phase,
    aReady,
    bReady,
    aOnline,
    bOnline,
    aPreload,
    bPreload,
    countdownRemaining,
    countdownSource,
    currentRound,
    playerA,
    playerB,
    winsA,
    winsB,
    threshold,
    matchWinner,
    lastResult,
    // 名字 / 元数据
    nameA,
    nameB,
    matchName,
    matchStatus,
    boFormat,
    winThreshold,
    scoringMethodName,
    countdownDelay,
    tournamentId,
    speedrunA,
    speedrunB,
    metaReady,
    // 日志
    messages,
    chatLines,
    draft,
    // subsegment 实时时间差（偏差条数据源）
    subsegmentGap,
    // 双席 live_time 实时计时（主计时器实时走表数据源）
    liveTimeA,
    liveTimeB,
    // 派生 / 动作
    isMulti,
    matchEnded,
    stageUrl,
    scenePageUrl,
    // 导演指令（WS 广播 → 舞台）
    currentSceneCmd,
    soonCmdState,
    remoteConfig,
    sendDirectorCommand,
    connect,
    connectWithAuth,
    disconnect,
    nameOf,
    playerOf,
    liveTimeOf,
  };
});

/**
 * WebSocket 协议：客户端 → 服务端 / 服务端 → 客户端 消息类型。
 * 与后端 src/twilightcupbackend/protocol.py 对齐。
 */
import type {
  Attempt,
  LevelTime,
  MatchPhase,
  Pick,
  PlayerStatus,
  RoundVerdict,
  SeatName,
} from "@/api/types";

// ---------------------------------------------------------------------------
// 客户端 → 服务端（构造器，返回即序化为 JSON 即可发送）
// ---------------------------------------------------------------------------

export interface ClientChat {
  type: "chat";
  text: string;
}
export interface ClientRefereeMarkPrep {
  type: "referee_mark_prep";
}
export interface ClientRefereeSelectPick {
  type: "referee_select_pick";
  pick_code: string;
  /** 选图本次 pick 附加的词条（CT/EX/CP 类别，0-ct_tag_count 个）。其余类别省略。 */
  tags?: string[];
  /** CT/EX 单关的重试次数（裁判选图时指定，必填 ≥1）。其余类别省略（沿用图池预设）。 */
  retry_count?: number;
}
export interface ClientRefereeManualStart {
  type: "referee_manual_start";
}
export interface ClientRefereeVerdict {
  type: "referee_verdict";
  round_id: string;
  verdict: RoundVerdict;
}
export interface ClientRefereeEditVerdict {
  type: "referee_edit_verdict";
  round_id: string;
  new_verdict: RoundVerdict;
}
export interface ClientRefereeTerminateRound {
  type: "referee_terminate_round";
  round_id: string;
  reason: string;
}
/** 裁判手动结束比赛（胜方按比分自动判定；需已达到取胜分数） */
export interface ClientRefereeEndMatch {
  type: "referee_end_match";
}
export interface ClientHeartbeat {
  type: "heartbeat";
}

// ---- 选手端消息（模拟游戏内输出）----
export interface ClientReadyToggle {
  type: "ready_toggle";
}
export interface ClientLevelTimeUpload {
  type: "level_time_upload";
  round_id: string;
  level_index: number;
  this_level_ms: number;
  total_ms?: number | null;
}
export interface ClientAttemptSkip {
  type: "attempt_skip";
  round_id: string;
  attempt_index: number;
}
export interface ClientProjectComplete {
  type: "project_complete";
  round_id: string;
  final_total_ms?: number | null;
}
export interface ClientForfeitSignal {
  type: "forfeit_signal";
  round_id: string;
  reason: "multi_exit" | "single_exit_0_valid";
}
export interface ClientReconnectResync {
  type: "reconnect_resync";
  round_id: string;
}
/** 选手端预载状态上报（仅选手席位，PREP 阶段有意义；SINGLE 合集报 "na"） */
export interface ClientPreloadReport {
  type: "preload_report";
  status: "in_progress" | "done" | "failed" | "na";
  /** 失败原因等，仅日志/告警用 */
  detail?: string | null;
}

/** 裁判上报完整 ban/pick 草稿状态（后端转发给导播；state 为任意 JSON） */
export interface ClientDraftSync {
  type: "draft_sync";
  state: Record<string, unknown>;
}

/**
 * 导播控制台发往同账号其他导播连接（OBS 舞台）的指令。
 * 后端收到后广播给同 match + 同 account_id 的其他 DIRECTOR 连接。
 */
export interface ClientDirectorCommand {
  type: "director_command";
  /** 指令类别 */
  action:
    | "switch_scene"
    | "soon_start"
    | "soon_pause"
    | "soon_reset"
    | "soon_set_target"
    | "config_update";
  /** 指令载荷（按 action 不同含义） */
  payload: Record<string, unknown>;
  // switch_scene:   { scene: "soon" }
  // soon_start:     {}
  // soon_pause:     {}
  // soon_reset:     {}
  // soon_set_target: { target_ms: 300000 }
  // config_update:  { config: { hlsA, hlsB, embedA, embedB } }
  //                 （直播画面配置实时下发，四键可部分缺失；服务端原样透传）
}

export type ClientMessage =
  | ClientChat
  | ClientRefereeMarkPrep
  | ClientRefereeSelectPick
  | ClientRefereeManualStart
  | ClientRefereeVerdict
  | ClientRefereeEditVerdict
  | ClientRefereeTerminateRound
  | ClientRefereeEndMatch
  | ClientHeartbeat
  | ClientReadyToggle
  | ClientLevelTimeUpload
  | ClientAttemptSkip
  | ClientProjectComplete
  | ClientForfeitSignal
  | ClientReconnectResync
  | ClientPreloadReport
  | ClientDraftSync
  | ClientDirectorCommand;

export const send = {
  chat: (text: string): ClientChat => ({ type: "chat", text }),
  refereeMarkPrep: (): ClientRefereeMarkPrep => ({ type: "referee_mark_prep" }),
  refereeSelectPick: (
    pick_code: string,
    tags?: string[],
    retryCount?: number,
  ): ClientRefereeSelectPick => ({
    type: "referee_select_pick",
    pick_code,
    ...(tags && tags.length > 0 ? { tags } : {}),
    ...(retryCount != null ? { retry_count: retryCount } : {}),
  }),
  refereeManualStart: (): ClientRefereeManualStart => ({ type: "referee_manual_start" }),
  refereeVerdict: (round_id: string, verdict: RoundVerdict): ClientRefereeVerdict => ({
    type: "referee_verdict",
    round_id,
    verdict,
  }),
  refereeEditVerdict: (
    round_id: string,
    new_verdict: RoundVerdict,
  ): ClientRefereeEditVerdict => ({ type: "referee_edit_verdict", round_id, new_verdict }),
  refereeTerminateRound: (
    round_id: string,
    reason: string,
  ): ClientRefereeTerminateRound => ({
    type: "referee_terminate_round",
    round_id,
    reason,
  }),
  refereeEndMatch: (): ClientRefereeEndMatch => ({ type: "referee_end_match" }),
  heartbeat: (): ClientHeartbeat => ({ type: "heartbeat" }),
  // ---- 选手端（模拟游戏内输出）----
  readyToggle: (): ClientReadyToggle => ({ type: "ready_toggle" }),
  levelTimeUpload: (
    round_id: string,
    level_index: number,
    this_level_ms: number,
    total_ms: number | null = null,
  ): ClientLevelTimeUpload => ({
    type: "level_time_upload",
    round_id,
    level_index,
    this_level_ms,
    total_ms,
  }),
  attemptSkip: (round_id: string, attempt_index: number): ClientAttemptSkip => ({
    type: "attempt_skip",
    round_id,
    attempt_index,
  }),
  projectComplete: (
    round_id: string,
    final_total_ms: number | null = null,
  ): ClientProjectComplete => ({
    type: "project_complete",
    round_id,
    final_total_ms,
  }),
  forfeitSignal: (
    round_id: string,
    reason: "multi_exit" | "single_exit_0_valid",
  ): ClientForfeitSignal => ({ type: "forfeit_signal", round_id, reason }),
  reconnectResync: (round_id: string): ClientReconnectResync => ({
    type: "reconnect_resync",
    round_id,
  }),
  // ---- 裁判端 ban/pick 草稿上报（转发给导播）----
  draftSync: (state: Record<string, unknown>): ClientDraftSync => ({
    type: "draft_sync",
    state,
  }),
  // ---- 导播控制台 → 舞台指令（WS 广播给同账号其他导播连接）----
  directorCommand: (
    action: ClientDirectorCommand["action"],
    payload: Record<string, unknown> = {},
  ): ClientDirectorCommand => ({
    type: "director_command",
    action,
    payload,
  }),
};

// ---------------------------------------------------------------------------
// 服务端 → 客户端
// ---------------------------------------------------------------------------

export interface SrvAuthOk {
  type: "auth_ok";
  account_id: string;
  display_name: string;
  seat: SeatName;
  match_id: string;
  match_name?: string | null;
  /** 选手 A 展示名（后端 auth_ok 即带，连入即拿，不必等聊天捕获） */
  player_a_name?: string | null;
  /** 选手 B 展示名 */
  player_b_name?: string | null;
}
export interface SrvAuthError {
  type: "auth_error";
  msg: string;
}
/**
 * 本连接被同身份（账号+座位+比赛）且带 exclusive=1 的新连接顶掉：
 * 先于 close(4001) 送达；被顶掉 ≠ 鉴权失败（token 仍有效），应停止自动重连
 * 并提示「已在其他窗口打开」。与后端 connection_manager.DISPLACED_* 对齐。
 */
export interface SrvDisplaced {
  type: "displaced";
  /** 目前仅 "superseded_by_new_connection" */
  reason: string;
}
export interface SrvChat {
  type: "chat";
  sender_id?: string | null;
  sender_name: string;
  seat: SeatName;
  text: string;
  ts: string;
}
export interface SrvSystem {
  type: "system";
  text: string;
  kind: string;
  /** 展示前缀：全场广播恒为 "Twilight"（定向 error 回执无此字段，沿用 System） */
  sender?: "Twilight" | "System";
  ts: string;
}
export interface SrvReadyState {
  type: "ready_state";
  a_ready: boolean;
  b_ready: boolean;
}
/** 双方预载状态广播（上报/重置时；absent = 从未上报） */
export interface SrvPreloadState {
  type: "preload_state";
  a_status: "absent" | "in_progress" | "done" | "failed" | "na";
  b_status: "absent" | "in_progress" | "done" | "failed" | "na";
}
/** 座席连接状态变化（选手/裁判连入或断开时广播；后端可选实现，见 docs/backend-seat-presence.md） */
export interface SrvSeatState {
  type: "seat_state";
  seat: SeatName;
  online: boolean;
}
export interface SrvPhaseChange {
  type: "phase_change";
  phase: MatchPhase;
  round_id?: string | null;
}
export interface SrvCountdownTick {
  type: "countdown_tick";
  remaining_secs: number;
  source: "auto" | "manual";
}
export interface SrvCountdownAbort {
  type: "countdown_abort";
  reason: string;
}
/** 选图确定即提前下发的合集预览（round_start 仍是唯一权威；与 round_start 的 pick/collection 同构） */
export interface SrvPickAnnounced {
  type: "pick_announced";
  pick_code: string;
  pick: Pick;
  collection: { raw: Record<string, unknown> };
}
export interface SrvRoundStart {
  type: "round_start";
  round_id: string;
  pick: Pick;
  collection: { raw: Record<string, unknown> };
}
export interface SrvRoundStartedBroadcast {
  type: "round_started_broadcast";
  round_id: string;
  pick_code: string;
  pick_name: string;
}
export interface SrvPlayerStatus {
  type: "player_status";
  seat: SeatName;
  account_id: string;
  status: PlayerStatus;
  current_level_index: number;
  completed_levels: LevelTime[];
  attempts: Attempt[];
}
export interface SrvLevelTimeUpdate {
  type: "level_time_update";
  seat: SeatName;
  account_id: string;
  level_index: number;
  this_level_ms: number;
  total_ms?: number | null;
  /** 完成时刻活跃的无效原因（缺省/空 = 有效；"!" 前缀 = 不可原谅）。 */
  invalid_reasons?: string[] | null;
}
export interface SrvRoundResult {
  type: "round_result";
  round_id: string;
  verdict: RoundVerdict;
  score_a_ms?: number | null;
  score_b_ms?: number | null;
  detail?: Record<string, unknown>;
}
export interface SrvCumulativeScore {
  type: "cumulative_score";
  wins_a: number;
  wins_b: number;
  threshold: number;
}
export interface SrvMatchEnd {
  type: "match_end";
  winner: "A" | "B";
}
export interface SrvCounterState {
  type: "counter_state";
  remaining_secs?: number | null;
}
export interface SrvCounterAlert {
  type: "counter_alert";
  remaining_secs: number;
}
export interface SrvVerdictEdit {
  type: "verdict_edit";
  round_id: string;
  old_verdict: RoundVerdict;
  new_verdict: RoundVerdict;
}
/** 广播 ban/pick 草稿状态给全员（含导播）；state 原样转发自裁判端 */
export interface SrvDraftState {
  type: "draft_state";
  state: Record<string, unknown>;
}

/**
 * 服务端广播给同账号其他导播连接的指令（原样转发 ClientDirectorCommand 的 action+payload）。
 * 导播控制台发 director_command → 后端广播 SrvDirectorCmd 给同 match 同 account_id 的其他 DIRECTOR 连接。
 *
 * 另含服务端主动下发的 state_sync（连接回放）：DIRECTOR 连接 auth_ok 后若有
 * 状态暂存，补发最近的场景/倒计时/配置，payload：
 *   { scene: string | null,
 *     soon: { target_ms, started_at, paused_at, now_ms }（服务器毫秒时间戳，
 *            now_ms 供前端做时钟偏移校正；started_at 已扣暂停时长），
 *     config: { hlsA, hlsB, embedA, embedB } }
 */
export interface SrvDirectorCmd {
  type: "director_cmd";
  action: string;
  payload: Record<string, unknown>;
}
export interface SrvError {
  type: "error";
  code: number;
  msg: string;
}

export type ServerMessage =
  | SrvAuthOk
  | SrvAuthError
  | SrvDisplaced
  | SrvChat
  | SrvSystem
  | SrvReadyState
  | SrvPreloadState
  | SrvSeatState
  | SrvPhaseChange
  | SrvCountdownTick
  | SrvCountdownAbort
  | SrvPickAnnounced
  | SrvRoundStart
  | SrvRoundStartedBroadcast
  | SrvPlayerStatus
  | SrvLevelTimeUpdate
  | SrvRoundResult
  | SrvCumulativeScore
  | SrvMatchEnd
  | SrvCounterState
  | SrvCounterAlert
  | SrvVerdictEdit
  | SrvDraftState
  | SrvDirectorCmd
  | SrvError;

/**
 * 与后端（TwilightCupBackend）对齐的类型定义。
 *
 * 约定：
 * - 服务端枚举经 orjson 序列化后多为整数（IntEnum 取值），这里用 number 表示，
 *   并提供 const 值映射 + 字面量联合类型以便安全引用。
 * - `seat` 字段在协议里是 IntEnum 的 **name 字符串**（"PLAYER_A" 等），故用字符串联合。
 * - `MatchLog.initial_info.scoring_method` 是后端写入的枚举 **name 字符串**（"FASTEST"/"AVERAGE"）。
 * - 日期时间字段一律以 ISO 字符串传输。
 */

// ---------------------------------------------------------------------------
// 枚举（const 值映射 + 字面量联合）
// ---------------------------------------------------------------------------

export const AccountType = { PLAYER: 1, REFEREE: 2, DIRECTOR: 3, ADMIN: 4 } as const;
export type AccountType = (typeof AccountType)[keyof typeof AccountType];

export type SeatName = "PLAYER_A" | "PLAYER_B" | "REFEREE" | "DIRECTOR";

export const MatchPhase = {
  IDLE: 0,
  PREP: 1,
  COUNTDOWN: 2,
  IN_ROUND: 3,
  ROUND_JUDGING: 4,
  ROUND_END: 5,
  MATCH_END: 6,
} as const;
export type MatchPhase = (typeof MatchPhase)[keyof typeof MatchPhase];

export const PlayerStatus = { IN_GAME: 1, COMPLETED: 2, FORFEITED: 3 } as const;
export type PlayerStatus = (typeof PlayerStatus)[keyof typeof PlayerStatus];

export const AttemptStatus = {
  VALID: 1,
  SKIPPED: 2,
  UNFINISHED: 3,
  INVALID: 4,
} as const;
export type AttemptStatus = (typeof AttemptStatus)[keyof typeof AttemptStatus];

export const PickType = { MULTI: 1, SINGLE: 2 } as const;
export type PickType = (typeof PickType)[keyof typeof PickType];

/**
 * 图池类别（文档 mappool_intro_cn.md）：
 * ML 多关 / IL 单关合集 / CP 存档点 / CT 自定义词条 / EX 工坊杂项 / TB 决胜局。
 * 后端 Category.name 即存该值（文档本就以 ML/IL/CP/CT/EX/TB 作类别名）。
 */
export const CategoryKind = {
  ML: "ML",
  IL: "IL",
  CP: "CP",
  CT: "CT",
  EX: "EX",
  TB: "TB",
} as const;
export type CategoryKind = (typeof CategoryKind)[keyof typeof CategoryKind];
/** 图池类别的固定顺序（编辑器下拉 / 展示排序用） */
export const CATEGORY_KINDS: CategoryKind[] = [
  CategoryKind.ML,
  CategoryKind.IL,
  CategoryKind.CP,
  CategoryKind.CT,
  CategoryKind.EX,
  CategoryKind.TB,
];

/**
 * CT 类别附加词条（文档：Glitchless / Pinch / Checkpoint / Jumpless / No Checkpoint / No EC）。
 * 单关 CT 选图额外可附加 Achievement。选手 pick CT 选图时可指定 0-2 个不冲突的词条。
 */
export const CT_TAGS = [
  "Glitchless",
  "Pinch",
  "Checkpoint",
  "Jumpless",
  "No Checkpoint",
  "No EC",
] as const;
export type CtTag = (typeof CT_TAGS)[number];
/** 单关 CT 选图额外的词条 */
export const CT_TAG_ACHIEVEMENT = "Achievement";
/** 已知冲突词条对（同时出现即不合法）； ban/pick 与编辑器校验共用 */
export const CT_TAG_CONFLICTS: ReadonlyArray<readonly [string, string]> = [
  ["Checkpoint", "No Checkpoint"],
];

export const ScoringMethod = { FASTEST: 1, AVERAGE: 2 } as const;
export type ScoringMethod = (typeof ScoringMethod)[keyof typeof ScoringMethod];

/** initial_info 里 scoring_method 以枚举 name 字符串记录 */
export type ScoringMethodName = "FASTEST" | "AVERAGE";

export const RoundSource = { NORMAL: 1, REMATCH: 2 } as const;
export type RoundSource = (typeof RoundSource)[keyof typeof RoundSource];

export const RoundVerdict = {
  A_WIN: 1,
  B_WIN: 2,
  TIE_REMATCH: 3,
  A_DISCONNECT_LOSS: 4,
  B_DISCONNECT_LOSS: 5,
} as const;
export type RoundVerdict = (typeof RoundVerdict)[keyof typeof RoundVerdict];

export const ChatSenderRole = { PLAYER: 1, REFEREE: 2, SYSTEM: 3 } as const;
export type ChatSenderRole = (typeof ChatSenderRole)[keyof typeof ChatSenderRole];

export const MatchStatus = { CREATED: 0, RUNNING: 1, ENDED: 2, PAUSED: 3 } as const;
export type MatchStatus = (typeof MatchStatus)[keyof typeof MatchStatus];

// ---- 赛程管理：赛事 / 对阵 枚举（对齐 datatypes.py 的 IntEnum）---------

export const TournamentStatus = {
  DRAFT: 0,
  READY: 1,
  IN_PROGRESS: 2,
  COMPLETED: 3,
  CANCELLED: 4,
} as const;
export type TournamentStatus = (typeof TournamentStatus)[keyof typeof TournamentStatus];

export const TournamentFormat = {
  SINGLE_ELIM: 1,
  DOUBLE_ELIM: 2,
  SWISS: 3,
} as const;
export type TournamentFormat = (typeof TournamentFormat)[keyof typeof TournamentFormat];

export const FixtureStatus = {
  PENDING: 0,
  READY: 1,
  RUNNING: 2,
  COMPLETED: 3,
  SKIPPED: 4,
} as const;
export type FixtureStatus = (typeof FixtureStatus)[keyof typeof FixtureStatus];

export const BracketSide = { MAIN: 0, WINNERS: 1, LOSERS: 2 } as const;
export type BracketSide = (typeof BracketSide)[keyof typeof BracketSide];

// ---------------------------------------------------------------------------
// 领域模型（REST 返回结构）
// ---------------------------------------------------------------------------

/** 登录端标识（admin/referee/director/player），后端据此校验角色 */
export type LoginEndpoint = "admin" | "referee" | "director" | "player";

export interface LoginRequest {
  username: string;
  password: string;
  /** 可选登录端：无对应角色则后端 403 ENDPOINT_FORBIDDEN 且不签发令牌 */
  endpoint?: LoginEndpoint | null;
}

export interface TokenResponse {
  access_token: string;
  token_type?: string;
  account_id: string;
  username: string; // 登录名（唯一）
  account_type: AccountType; // 主角色（最高优先级）
  roles: AccountType[]; // 角色集合
  display_name: string;
}

export interface CollectionConfig {
  raw: Record<string, unknown>;
}

export interface Pick {
  code: string;
  name: string;
  type: PickType;
  retry_count?: number | null;
  collection: CollectionConfig;
  tag?: string | null;
  category?: string | null;
  /**
   * 前端派生字段（**不入库**，后端 extra=ignore 会丢弃）：CT 选图的结构化附加词条。
   * 由 utils/mappool 的 normalize 从 `tag`（逗号分隔）解码填充；提交前再编码回 `tag`。
   */
  tags?: string[];
  /** 前端派生字段（**不入库**）：是否决胜局选图，等价于所属类别 kind === "TB"。 */
  isTiebreaker?: boolean;
  /** 展示图 MinIO object key（管理员上传后写入，持久化）。 */
  logo?: string | null;
  /** logo 的公开访问 URL（桶公开读 + nginx 反代，固定永久有效；由后端输出层填，不持久化）。 */
  logo_url?: string | null;
  /**
   * speedrun.com 排行榜映射（**持久化**，管理端图池编辑器配置；游戏固定为
   * Human: Fall Flat）。导播 categoryinfo 场景按此拉取该项目 Top 榜。
   * speedrun_category_id 为空 = 未映射（场景显示占位卡）。
   */
  speedrun_category_id?: string | null;
  /** 单关 IL 分类的关卡 id；全游戏分类为 null */
  speedrun_level_id?: string | null;
  /** 子分类过滤 {varId: valueId}（如 IL subcategory: Checkpoint%） */
  speedrun_variables?: Record<string, string>;
}

export interface LevelTime {
  level_index: number;
  time_ms: number;
  total_ms?: number | null;
  /** 完成时刻活跃的无效原因（MULTI informational，仲裁归裁判）。 */
  invalid_reasons?: string[];
}

export interface Attempt {
  index: number;
  status: AttemptStatus;
  time_ms?: number | null;
  /** INVALID 时的证据；元素 "<Reason>"，不可原谅带 "!" 前缀（如 "!CheatCode"）。 */
  invalid_reasons?: string[];
}

export interface PlayerRoundState {
  account_id: string;
  status: PlayerStatus;
  current_level_index: number;
  completed_levels: LevelTime[];
  attempts: Attempt[];
  final_total_ms?: number | null;
  forfeited: boolean;
}

export interface RoundRecord {
  id: string;
  match_id: string;
  round_no: number;
  pick_code: string;
  pick_snapshot: Pick;
  collection_snapshot: CollectionConfig;
  source: RoundSource;
  counted: boolean;
  superseded_by?: string | null;
  state_a: PlayerRoundState;
  state_b: PlayerRoundState;
  verdict?: RoundVerdict | null;
  score_a_ms?: number | null;
  score_b_ms?: number | null;
  created_at: string;
  ended_at?: string | null;
}

export interface MatchLogInitialInfo {
  name?: string;
  bo_format?: number;
  win_threshold?: number;
  scoring_method?: ScoringMethodName;
  start_countdown_delay?: number;
  ban_count?: number;
  protect_count?: number;
  /** CT 选图每次 pick 可附带的词条数上限 */
  ct_tag_count?: number;
  player_a_id?: string;
  player_b_id?: string;
  referee_id?: string;
  director_id?: string;
  mappool?: string[];
  [k: string]: unknown;
}

/**
 * ban/pick/protect 草稿快照（整场一次）。后端按需持久化（见 docs/backend-banpick-persist.md），
 * 前端管理端「比赛详情-回合数据」据此展示。字段对齐裁判端 draft store：
 * - actions：选图 ban/protect 动作（by=A/B, kind=ban/protect, code=选图编号）
 * - picks：跨回合累积的选图（by=A/B, code）
 * - bannedTags / tagBanBy：CT 词条禁用（被禁词条双方均不可选）
 */
export interface DraftSnapshotAction {
  by: "A" | "B";
  code: string;
  kind: "ban" | "protect";
}
export interface DraftSnapshotPick {
  by: "A" | "B";
  code: string;
  /** CT/EX/CP 选图随 referee_select_pick 提交的词条 */
  tags?: string[];
  /** CT/EX 单关裁判指定的重试次数 */
  retry?: number;
}
export interface DraftSnapshot {
  actions?: DraftSnapshotAction[];
  picks?: DraftSnapshotPick[];
  bannedTags?: string[];
  tagBanBy?: { A: string | null; B: string | null };
}

export interface MatchLog {
  id: string;
  match_id: string;
  /** 所属赛事 id（独立比赛为 null）；导播端据此生成赛程图场景页链接 */
  tournament_id?: string | null;
  initial_info: MatchLogInitialInfo;
  round_ids: string[];
  final_result?: { winner?: "A" | "B"; wins_a?: number; wins_b?: number } | null;
  /** 裁判端上报的 ban/pick/protect 快照（后端可选持久化；缺失则管理端不显示该区）。 */
  draft_snapshot?: DraftSnapshot | null;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  match_id: string;
  sender_role: ChatSenderRole;
  sender_id?: string | null;
  sender_name: string;
  text: string;
  is_system: boolean;
  ts: string;
}

// ---------------------------------------------------------------------------
// 管理员域（账号 / 比赛管理，对齐 rest/schemas.py）
// ---------------------------------------------------------------------------

export interface AccountOut {
  id: string;
  username: string;
  roles: AccountType[];
  display_name: string;
  /** speedrun.com 账号绑定（用户名或 8 位用户 id；未绑定为 null） */
  speedrun_id?: string | null;
  created_at: string;
}

export interface AccountCreate {
  username: string;
  password: string;
  display_name: string;
  roles: AccountType[];
  speedrun_id?: string | null;
}

/** PATCH /admin/accounts/{id} 按字段局部更新，传哪个改哪个（speedrun_id 空串=解绑） */
export interface AccountUpdate {
  display_name?: string;
  password?: string;
  roles?: AccountType[];
  speedrun_id?: string | null;
}

/** PATCH /me 修改自己的展示名（任意已登录账号） */
export interface DisplayNameUpdate {
  display_name: string;
}

/** POST /me/password 修改自己的口令（须校验旧口令；新口令至少 4 位） */
export interface PasswordChange {
  old_password: string;
  new_password: string;
}

/** 图池类别（仅展示分组，无程序逻辑） */
export interface Category {
  name: string;
  picks: Pick[];
}

/** 图池：一场比赛所有可选项目的集合 */
export interface Mappool {
  categories: Category[];
}

/** 图池库条目：可复用的图池定义，创建比赛时按 id 引用（后端 /admin/mappools） */
export interface MappoolLibItem {
  id: string;
  name: string;
  mappool: Mappool;
  created_by: string;
  created_at: string;
}

export interface MappoolCreate {
  name: string;
  mappool: Mappool;
}

export interface MappoolUpdate {
  name?: string;
  mappool?: Mappool;
}

/** 关卡条目：可复用的关卡定义（后端 /admin/levels，「关卡管理」页维护）；name 唯一且创建后不可改 */
export interface Level {
  id: string;
  /** 唯一、不可变；选图 raw.levels 引用该值（关卡 id） */
  name: string;
  display_name: string;
  /** 展示图 MinIO object key（持久化） */
  logo?: string | null;
  /** logo 公开访问 URL（后端输出层拼，不持久化） */
  logo_url?: string | null;
  created_at: string;
}

export interface LevelCreate {
  name: string;
  display_name?: string;
  logo?: string | null;
}

/** PATCH /admin/levels/{id}：name 不可改，仅可改 display_name / logo */
export interface LevelUpdate {
  display_name?: string;
  logo?: string | null;
}

export interface MatchOut {
  id: string;
  name: string;
  bo_format: number;
  win_threshold: number;
  scoring_method: ScoringMethod;
  start_countdown_delay: number;
  ban_count: number;
  protect_count: number;
  /** CT 选图每次 pick 可附带的词条数上限（默认 2；后端未上该字段时前端回退 2） */
  ct_tag_count?: number;
  status: MatchStatus;
  mappool: Mappool;
  player_a_id: string;
  player_b_id: string;
  player_a_username: string;
  player_b_username: string;
  /** 双方选手的 speedrun.com 账号绑定（categoryinfo 场景高亮用；未绑定为 null） */
  player_a_speedrun?: string | null;
  player_b_speedrun?: string | null;
  referee_id: string;
  director_id: string;
  winner: "A" | "B" | null;
  /** 所属赛事 id（孤立比赛为默认容器 "default"；后端已下发，前端用于舞台 URL 等 */
  tournament_id?: string | null;
  created_at: string;
  started_at?: string | null;
  ended_at?: string | null;
  /** 归档时间（仅 ENDED 可归档；null/缺失 = 未归档。纯列表整理，不影响状态机） */
  archived_at?: string | null;
}

export interface MatchCreate {
  name: string;
  bo_format: number;
  /** 省略时后端按 (bo//2)+1 推导 */
  win_threshold?: number;
  scoring_method: ScoringMethod;
  start_countdown_delay: number;
  /** 每方选图 ban 数（默认 1） */
  ban_count?: number;
  /** 每方选图 protect 数（0=无 protect，默认 1） */
  protect_count?: number;
  /** CT 选图每次 pick 可附带的词条数上限（0=禁用词条，默认 2） */
  ct_tag_count?: number;
  /** 内联图池（与 mappool_id 二选一；前端默认用 mappool_id） */
  mappool?: Mappool;
  /** 引用图池库中的图池 id（优先于内联 mappool） */
  mappool_id?: string;
  /** 角色账号以用户名指定，服务端校验类型并解析为 id */
  player_a: string;
  player_b: string;
  referee: string;
  director: string;
}

/** PATCH /admin/matches/{id} 局部更新（可选字段；改选手或切回 RUNNING 时由后端做冲突校验） */
export interface MatchUpdate {
  name?: string;
  player_a?: string;
  player_b?: string;
  status?: MatchStatus;
}

/** 比赛摘要（/me/matches 列表用，不含图池等重字段；展示名服务端解析） */
export interface MatchSummary {
  id: string;
  name: string;
  bo_format: number;
  win_threshold: number;
  status: MatchStatus;
  player_a_name: string;
  player_b_name: string;
  referee_name: string;
  created_at: string;
  started_at?: string | null;
  ended_at?: string | null;
}

// ---------------------------------------------------------------------------
// 赛程管理：赛事 / 对阵（对齐 rest/schemas.py）
// ---------------------------------------------------------------------------

export interface TournamentCreate {
  name: string;
  format: TournamentFormat;
  swiss_rounds?: number;
  swiss_win_points?: number;
  swiss_loss_points?: number;
  swiss_draw_points?: number;
}

/** 仅 DRAFT 赛事可改核心字段；不允许改 format */
export interface TournamentUpdate {
  name?: string;
  swiss_rounds?: number;
  swiss_win_points?: number;
  swiss_loss_points?: number;
  swiss_draw_points?: number;
}

/** 赛事单项排名（嵌入 TournamentOut.final_standings） */
export interface TournamentStanding {
  account_id: string;
  rank: number;
  points: number;
  wins: number;
  losses: number;
  draws: number;
  eliminated_round: number | null;
  buchholz: number | null;
  note: string | null;
}

/** 默认赛事（孤立比赛容器）固定主键，与后端 datatypes.DEFAULT_TOURNAMENT_ID 对齐 */
export const DEFAULT_TOURNAMENT_ID = "default";

export interface TournamentOut {
  id: string;
  name: string;
  format: TournamentFormat;
  status: TournamentStatus;
  participant_ids: string[];
  seed_order: string[];
  referee_ids: string[];
  director_ids: string[];
  swiss_rounds: number | null;
  swiss_win_points: number;
  swiss_loss_points: number;
  swiss_draw_points: number;
  bracket_generated_at: string | null;
  current_round: number;
  total_rounds: number | null;
  winner_id: string | null;
  final_standings: TournamentStanding[] | null;
  created_by: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

/** GET /admin/tournaments/{id}/standings 项（控制器注入 display_name） */
export interface TournamentStandingOut extends TournamentStanding {
  display_name: string;
}

export interface FixtureOut {
  id: string;
  tournament_id: string;
  round_no: number;
  bracket_side: BracketSide;
  match_index: number;
  player_a_id: string | null;
  player_b_id: string | null;
  /** 选手 A 展示名（BracketView.build 一次性解析注入，避免前端 N+1） */
  player_a_name?: string | null;
  player_b_name?: string | null;
  is_bye: boolean;
  advances_to: string | null;
  advances_slot: string | null;
  losers_drops_to: string | null;
  losers_drop_slot: string | null;
  depends_on: string[];
  referee_id: string | null;
  director_id: string | null;
  match_id: string | null;
  winner_id: string | null;
  /** 已结束对阵的累计比分（后端 BracketView.build 从 match_log.final_result 填） */
  score_a?: number | null;
  score_b?: number | null;
  status: FixtureStatus;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface BracketRound {
  round_no: number;
  bracket_side: BracketSide;
  fixtures: FixtureOut[];
}

export interface BracketView {
  tournament_id: string;
  format: TournamentFormat;
  current_round: number;
  total_rounds: number | null;
  rounds: BracketRound[];
}

/** 批量按用户名增删成员（选手/裁判/导播通用） */
export interface UsernamesBody {
  usernames: string[];
}

/** 设置种子序（account.id 列表，长度须等于参赛选手数） */
export interface SeedOrderBody {
  seed_order: string[];
}

/** 为对阵指派裁判 / 导播（用户名；空值不传） */
export interface FixtureAssignBody {
  referee?: string | null;
  director?: string | null;
}

/** 为对阵生成比赛时传入的单场规则 + 图池（赛事不再持有这些，每次开局指定） */
export interface FixtureCreateMatchBody {
  bo_format: number;
  /** 省略时后端按 (bo//2)+1 推导 */
  win_threshold?: number;
  scoring_method: ScoringMethod;
  start_countdown_delay: number;
  ban_count: number;
  protect_count: number;
  /** CT 选图每次 pick 可附带的词条数上限（0=禁用词条，默认 2） */
  ct_tag_count?: number;
  /** 引用图池库 id（冻结为快照内嵌本场） */
  mappool_id: string;
}

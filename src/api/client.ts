/**
 * REST 客户端：登录与日志查询（裁判有权访问的接口）。
 * 所有非健康检查接口需 Bearer JWT。
 */
import { restBase } from "./config";
import type {
  AccountCreate,
  AccountOut,
  AccountUpdate,
  BracketView,
  ChatMessage,
  DisplayNameUpdate,
  FixtureAssignBody,
  FixtureCreateMatchBody,
  FixtureOut,
  LoginRequest,
  MappoolCreate,
  MappoolLibItem,
  MappoolUpdate,
  Level,
  LevelCreate,
  LevelUpdate,
  MatchLog,
  PasswordChange,
  RoundRecord,
  SeedOrderBody,
  MatchCreate,
  MatchOut,
  MatchSummary,
  MatchUpdate,
  TokenResponse,
  TournamentCreate,
  TournamentOut,
  TournamentStandingOut,
  TournamentUpdate,
  UsernamesBody,
} from "./types";

export class ApiError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

/**
 * 会话过期统一处理（带令牌的请求被 401 拒绝 / WS 鉴权失败且令牌确已过期）。
 * 主应用入口注入「登出 + 跳登录页」；OBS 场景独立入口不注入 → 返回 false，
 * 调用方维持原有兜底（mock 数据 / 遮罩提示），绝不让直播画面跳走。
 */
let sessionExpiredHandler: (() => void) | null = null;

export function setSessionExpiredHandler(fn: (() => void) | null): void {
  sessionExpiredHandler = fn;
}

/** 触发会话过期处理；返回 false 表示无人接管（调用方维持原有错误展示） */
export function notifySessionExpired(): boolean {
  if (!sessionExpiredHandler) return false;
  sessionExpiredHandler();
  return true;
}

function extractMsg(data: unknown, status: number, fallback: string): string {
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (typeof d.msg === "string") return d.msg;
    if (Array.isArray(d.detail)) {
      // FastAPI 422 校验错误
      const first = d.detail[0] as Record<string, unknown> | undefined;
      if (first && typeof first.msg === "string") return first.msg;
    }
    if (typeof d.detail === "string") return d.detail;
  }
  if (typeof data === "string" && data.length > 0) return data;
  return fallback || `HTTP ${status}`;
}

async function request<T>(
  path: string,
  options: RequestInit & { token?: string } = {},
): Promise<T> {
  const { token, headers, ...rest } = options;
  const res = await fetch(`${restBase}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(headers as Record<string, string> | undefined),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    // 带令牌的请求被 401 拒绝 = 会话已死（过期/吊销）→ 统一登出跳登录；
    // 登录接口本身不带令牌（口令错误也是 401），不受影响
    if (res.status === 401 && token) notifySessionExpired();
    throw new ApiError(res.status, extractMsg(data, res.status, `HTTP ${res.status}`));
  }
  return data as T;
}

/**
 * multipart 文件上传（如 logo）：不设 Content-Type，交浏览器附带 boundary。
 * 后端 POST /admin/uploads（管理员）返回 { key, url }（url 为 MinIO 公开访问 URL）。
 */
async function uploadFile(
  path: string,
  file: File,
  field: string,
  token: string,
): Promise<{ key: string; url: string | null }> {
  const form = new FormData();
  form.append(field, file);
  const res = await fetch(`${restBase}${path}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    if (res.status === 401) notifySessionExpired();
    throw new ApiError(res.status, extractMsg(data, res.status, `HTTP ${res.status}`));
  }
  return data as { key: string; url: string | null };
}

export const api = {
  login(body: LoginRequest): Promise<TokenResponse> {
    return request<TokenResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  getMatchLog(matchId: string, token: string): Promise<MatchLog> {
    return request<MatchLog>(
      `/logs/matches/${encodeURIComponent(matchId)}/match_log`,
      { method: "GET", token },
    );
  },

  // ---- 当前账号（任意已登录）-------------------------------------------

  listMyMatches(token: string): Promise<MatchSummary[]> {
    return request<MatchSummary[]>("/me/matches", { method: "GET", token });
  },

  /** 当前账号参与的比赛详情（含结构化图池，成员可见，供裁判端 ban/pick 载入） */
  getMyMatch(matchId: string, token: string): Promise<MatchOut> {
    return request<MatchOut>(
      `/me/matches/${encodeURIComponent(matchId)}`,
      { method: "GET", token },
    );
  },

  /** 裁判激活比赛（CREATED → RUNNING，限该场裁判/admin） */
  startMatch(matchId: string, token: string): Promise<MatchOut> {
    return request<MatchOut>(
      `/me/matches/${encodeURIComponent(matchId)}/start`,
      { method: "POST", token },
    );
  },

  /** 裁判暂停比赛（RUNNING → PAUSED，保留进度并释放选手占用，限该场裁判/admin） */
  pauseMatch(matchId: string, token: string): Promise<MatchOut> {
    return request<MatchOut>(
      `/me/matches/${encodeURIComponent(matchId)}/pause`,
      { method: "POST", token },
    );
  },

  /** 裁判恢复比赛（PAUSED → RUNNING；后端校验选手不在其他进行中比赛，冲突 409） */
  resumeMatch(matchId: string, token: string): Promise<MatchOut> {
    return request<MatchOut>(
      `/me/matches/${encodeURIComponent(matchId)}/resume`,
      { method: "POST", token },
    );
  },

  getChatLog(matchId: string, token: string): Promise<ChatMessage[]> {
    return request<ChatMessage[]>(
      `/logs/matches/${encodeURIComponent(matchId)}/chat`,
      { method: "GET", token },
    );
  },

  getRoundDetail(
    matchId: string,
    roundNo: number,
    token: string,
  ): Promise<RoundRecord> {
    return request<RoundRecord>(
      `/logs/matches/${encodeURIComponent(matchId)}/rounds/${roundNo}`,
      { method: "GET", token },
    );
  },

  /** 修改自己的展示名（任意已登录账号；非敏感，无需旧口令） */
  updateDisplayName(
    body: DisplayNameUpdate,
    token: string,
  ): Promise<AccountOut> {
    return request<AccountOut>("/me", {
      method: "PATCH",
      token,
      body: JSON.stringify(body),
    });
  },

  /** 修改自己的口令（须校验旧口令；新口令至少 4 位） */
  changePassword(body: PasswordChange, token: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>("/me/password", {
      method: "POST",
      token,
      body: JSON.stringify(body),
    });
  },

  // ---- 账号管理（管理员）-------------------------------------------------

  listAccounts(token: string): Promise<AccountOut[]> {
    return request<AccountOut[]>("/admin/accounts", { method: "GET", token });
  },

  createAccount(body: AccountCreate, token: string): Promise<AccountOut> {
    return request<AccountOut>("/admin/accounts", {
      method: "POST",
      token,
      body: JSON.stringify(body),
    });
  },

  getAccount(accountId: string, token: string): Promise<AccountOut> {
    return request<AccountOut>(
      `/admin/accounts/${encodeURIComponent(accountId)}`,
      { method: "GET", token },
    );
  },

  updateAccount(
    accountId: string,
    body: AccountUpdate,
    token: string,
  ): Promise<AccountOut> {
    return request<AccountOut>(
      `/admin/accounts/${encodeURIComponent(accountId)}`,
      { method: "PATCH", token, body: JSON.stringify(body) },
    );
  },

  async deleteAccount(accountId: string, token: string): Promise<void> {
    await request<void>(`/admin/accounts/${encodeURIComponent(accountId)}`, {
      method: "DELETE",
      token,
    });
  },

  // ---- 比赛管理（管理员）-------------------------------------------------

  listMatches(token: string): Promise<MatchOut[]> {
    return request<MatchOut[]>("/admin/matches", { method: "GET", token });
  },

  createMatch(body: MatchCreate, token: string): Promise<MatchOut> {
    return request<MatchOut>("/admin/matches", {
      method: "POST",
      token,
      body: JSON.stringify(body),
    });
  },

  getMatch(matchId: string, token: string): Promise<MatchOut> {
    return request<MatchOut>(
      `/admin/matches/${encodeURIComponent(matchId)}`,
      { method: "GET", token },
    );
  },

  /** 管理员局部更新比赛（改选手/状态等；改选手或切 RUNNING 时后端做冲突校验） */
  updateMatch(matchId: string, body: MatchUpdate, token: string): Promise<MatchOut> {
    return request<MatchOut>(
      `/admin/matches/${encodeURIComponent(matchId)}`,
      { method: "PATCH", token, body: JSON.stringify(body) },
    );
  },

  /** 管理员强制结束比赛（RUNNING/CREATED → ENDED；断开选手并广播结束） */
  forceEndMatch(matchId: string, token: string): Promise<{ ok: boolean }> {
    return request<{ ok: boolean }>(
      `/admin/matches/${encodeURIComponent(matchId)}/end`,
      { method: "POST", token },
    );
  },

  /** 归档已结束比赛（仅 ENDED；archived_at 置当前时间，返回更新后的比赛） */
  archiveMatch(matchId: string, token: string): Promise<MatchOut> {
    return request<MatchOut>(
      `/admin/matches/${encodeURIComponent(matchId)}/archive`,
      { method: "POST", token },
    );
  },

  /** 取消归档（archived_at 置 null，返回更新后的比赛） */
  unarchiveMatch(matchId: string, token: string): Promise<MatchOut> {
    return request<MatchOut>(
      `/admin/matches/${encodeURIComponent(matchId)}/unarchive`,
      { method: "POST", token },
    );
  },

  /** 当前账号参与的赛事（作为选手/裁判/导播） */
  listMyTournaments(token: string): Promise<TournamentOut[]> {
    return request<TournamentOut[]>("/me/tournaments", { method: "GET", token });
  },

  /** 赛事对阵树（赛事成员可读；含已结束对阵的 score_a/score_b） */
  getMyBracket(tournamentId: string, token: string): Promise<BracketView> {
    return request<BracketView>(
      `/me/tournaments/${encodeURIComponent(tournamentId)}/bracket`,
      { method: "GET", token },
    );
  },

  /** 赛事图池（赛事成员可读；取该赛事第一场已生成比赛的图池，含 logo_url） */
  getMyTournamentMappool(tournamentId: string, token: string): Promise<MappoolLibItem> {
    return request<MappoolLibItem>(
      `/me/tournaments/${encodeURIComponent(tournamentId)}/mappool`,
      { method: "GET", token },
    );
  },

  // ---- 图池库（管理员）---------------------------------------------------

  listMappools(token: string): Promise<MappoolLibItem[]> {
    return request<MappoolLibItem[]>("/admin/mappools", { method: "GET", token });
  },

  getMappool(mappoolId: string, token: string): Promise<MappoolLibItem> {
    return request<MappoolLibItem>(
      `/admin/mappools/${encodeURIComponent(mappoolId)}`,
      { method: "GET", token },
    );
  },

  createMappool(body: MappoolCreate, token: string): Promise<MappoolLibItem> {
    return request<MappoolLibItem>("/admin/mappools", {
      method: "POST",
      token,
      body: JSON.stringify(body),
    });
  },

  updateMappool(
    mappoolId: string,
    body: MappoolUpdate,
    token: string,
  ): Promise<MappoolLibItem> {
    return request<MappoolLibItem>(
      `/admin/mappools/${encodeURIComponent(mappoolId)}`,
      { method: "PATCH", token, body: JSON.stringify(body) },
    );
  },

  async deleteMappool(mappoolId: string, token: string): Promise<void> {
    await request<void>(`/admin/mappools/${encodeURIComponent(mappoolId)}`, {
      method: "DELETE",
      token,
    });
  },

  // ---- 关卡管理（管理员）---------------------------------------------------

  listLevels(token: string): Promise<Level[]> {
    return request<Level[]>("/admin/levels", { method: "GET", token });
  },

  getLevel(levelId: string, token: string): Promise<Level> {
    return request<Level>(
      `/admin/levels/${encodeURIComponent(levelId)}`,
      { method: "GET", token },
    );
  },

  createLevel(body: LevelCreate, token: string): Promise<Level> {
    return request<Level>("/admin/levels", {
      method: "POST",
      token,
      body: JSON.stringify(body),
    });
  },

  /** name 不可改；仅可改 display_name / logo */
  updateLevel(levelId: string, body: LevelUpdate, token: string): Promise<Level> {
    return request<Level>(
      `/admin/levels/${encodeURIComponent(levelId)}`,
      { method: "PATCH", token, body: JSON.stringify(body) },
    );
  },

  async deleteLevel(levelId: string, token: string): Promise<void> {
    await request<void>(`/admin/levels/${encodeURIComponent(levelId)}`, {
      method: "DELETE",
      token,
    });
  },

  // ---- 静态资源上传（管理员：logo 等）------------------------------------
  /**
   * 上传 logo 图（png/jpg/webp/gif，≤5MB）到 MinIO，返回 { key, url }。
   * key 写入 Pick.logo 持久化；url 为固定公开访问 URL（桶公开读 + nginx 反代，永久有效）。
   */
  uploadLogo(file: File, token: string): Promise<{ key: string; url: string | null }> {
    return uploadFile("/admin/uploads", file, "file", token);
  },

  /**
   * 按 object key 取固定公开访问 URL（任意已登录）。
   * 桶公开读后 URL 永久有效；MatchOut 未填 logo_url 时，用 Pick.logo 调此补取。
   */
  signLogoUrl(key: string, token: string): Promise<{ key: string; url: string | null }> {
    return request<{ key: string; url: string | null }>(
      `/admin/uploads/sign?key=${encodeURIComponent(key)}`,
      { method: "GET", token },
    );
  },

  // ---- 赛事管理（管理员）-------------------------------------------------

  listTournaments(token: string): Promise<TournamentOut[]> {
    return request<TournamentOut[]>("/admin/tournaments", {
      method: "GET",
      token,
    });
  },

  createTournament(body: TournamentCreate, token: string): Promise<TournamentOut> {
    return request<TournamentOut>("/admin/tournaments", {
      method: "POST",
      token,
      body: JSON.stringify(body),
    });
  },

  getTournament(tournamentId: string, token: string): Promise<TournamentOut> {
    return request<TournamentOut>(
      `/admin/tournaments/${encodeURIComponent(tournamentId)}`,
      { method: "GET", token },
    );
  },

  updateTournament(
    tournamentId: string,
    body: TournamentUpdate,
    token: string,
  ): Promise<TournamentOut> {
    return request<TournamentOut>(
      `/admin/tournaments/${encodeURIComponent(tournamentId)}`,
      { method: "PATCH", token, body: JSON.stringify(body) },
    );
  },

  async deleteTournament(tournamentId: string, token: string): Promise<void> {
    await request<void>(
      `/admin/tournaments/${encodeURIComponent(tournamentId)}`,
      { method: "DELETE", token },
    );
  },

  // ---- 赛事成员池（仅 DRAFT）--------------------------------------------

  addParticipants(
    tournamentId: string,
    body: UsernamesBody,
    token: string,
  ): Promise<TournamentOut> {
    return request<TournamentOut>(
      `/admin/tournaments/${encodeURIComponent(tournamentId)}/participants`,
      { method: "POST", token, body: JSON.stringify(body) },
    );
  },

  removeParticipants(
    tournamentId: string,
    body: UsernamesBody,
    token: string,
  ): Promise<TournamentOut> {
    return request<TournamentOut>(
      `/admin/tournaments/${encodeURIComponent(tournamentId)}/participants/remove`,
      { method: "POST", token, body: JSON.stringify(body) },
    );
  },

  addReferees(
    tournamentId: string,
    body: UsernamesBody,
    token: string,
  ): Promise<TournamentOut> {
    return request<TournamentOut>(
      `/admin/tournaments/${encodeURIComponent(tournamentId)}/referees`,
      { method: "POST", token, body: JSON.stringify(body) },
    );
  },

  addDirectors(
    tournamentId: string,
    body: UsernamesBody,
    token: string,
  ): Promise<TournamentOut> {
    return request<TournamentOut>(
      `/admin/tournaments/${encodeURIComponent(tournamentId)}/directors`,
      { method: "POST", token, body: JSON.stringify(body) },
    );
  },

  setSeeds(
    tournamentId: string,
    body: SeedOrderBody,
    token: string,
  ): Promise<TournamentOut> {
    return request<TournamentOut>(
      `/admin/tournaments/${encodeURIComponent(tournamentId)}/seeds`,
      { method: "POST", token, body: JSON.stringify(body) },
    );
  },

  // ---- 赛程推进 ---------------------------------------------------------

  generateBracket(tournamentId: string, token: string): Promise<BracketView> {
    return request<BracketView>(
      `/admin/tournaments/${encodeURIComponent(tournamentId)}/generate-bracket`,
      { method: "POST", token },
    );
  },

  /** 瑞士轮专用：按当前积分荷兰式配对生成下一轮（淘汰赛返回 400） */
  generateNextRound(tournamentId: string, token: string): Promise<BracketView> {
    return request<BracketView>(
      `/admin/tournaments/${encodeURIComponent(tournamentId)}/next-round`,
      { method: "POST", token },
    );
  },

  getBracket(tournamentId: string, token: string): Promise<BracketView> {
    return request<BracketView>(
      `/admin/tournaments/${encodeURIComponent(tournamentId)}/bracket`,
      { method: "GET", token },
    );
  },

  getStandings(
    tournamentId: string,
    token: string,
  ): Promise<TournamentStandingOut[]> {
    return request<TournamentStandingOut[]>(
      `/admin/tournaments/${encodeURIComponent(tournamentId)}/standings`,
      { method: "GET", token },
    );
  },

  getFixture(
    tournamentId: string,
    fixtureId: string,
    token: string,
  ): Promise<FixtureOut> {
    return request<FixtureOut>(
      `/admin/tournaments/${encodeURIComponent(tournamentId)}/fixtures/${encodeURIComponent(fixtureId)}`,
      { method: "GET", token },
    );
  },

  assignOfficials(
    tournamentId: string,
    fixtureId: string,
    body: FixtureAssignBody,
    token: string,
  ): Promise<FixtureOut> {
    return request<FixtureOut>(
      `/admin/tournaments/${encodeURIComponent(tournamentId)}/fixtures/${encodeURIComponent(fixtureId)}/assign`,
      { method: "POST", token, body: JSON.stringify(body) },
    );
  },

  createMatchForFixture(
    tournamentId: string,
    fixtureId: string,
    body: FixtureCreateMatchBody,
    token: string,
  ): Promise<MatchOut> {
    return request<MatchOut>(
      `/admin/tournaments/${encodeURIComponent(tournamentId)}/fixtures/${encodeURIComponent(fixtureId)}/create-match`,
      { method: "POST", token, body: JSON.stringify(body) },
    );
  },
};

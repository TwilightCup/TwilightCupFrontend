/**
 * speedrun.com 数据客户端（管理端图池映射选择器与导播 categoryinfo 场景共用）。
 *
 * - 全部请求走**后端同源代理**（`{restBase}/speedrun/*`，见后端
 *   rest/speedrun_proxy.py）：浏览器 / OBS CEF 直连 speedrun.com 在部分网络
 *   环境不可达（跨域、浏览器扩展、代理策略等），后端统一拉取并做两级缓存
 *   （进程内 TTL + Mongo 持久化按速通项目区分存储；上游限流 100 请求/分，
 *   超限 HTTP 420 原样透传）。
 * - 榜单 / PB / 用户解析走 **SWR 双请求**（swrGet）：mode=cached 秒回后端
 *   持久化缓存先渲染，mode=refresh 并发拉上游成功后替换；上游失败时保留
 *   缓存渲染不回退。meta 类（游戏/变量）仍走单请求 cachedGet（默认 auto）。
 * - 代理端点需 JWT（调用方先 setSpeedrunToken；场景页传 URL token、管理端
 *   传 auth token；无 token 的 mock 预览不发请求）。
 * - 本模块另按路径缓存（带 TTL）+ 并发去重（同路径在途请求复用同一 Promise）。
 * - 上游资源含义：HFF = Human: Fall Flat（缩写 hff → 固定 id k6qgnmdg）；
 *   用缩写作 id 的上游 URL 会 302，由后端 follow_redirects 跟随。
 */

import { restBase } from "@/api/config";

/** speedrun.com 上的游戏 id：HFF 主游戏 + Category Extensions 子游戏
 *  （No Checkpoint% / Jumpless% 词条项目在子游戏上） */
export const SPEEDRUN_GAMES = {
  hff: "k6qgnmdg",
  ext: "o6gl20nd",
} as const;

/** speedrun.com 上 Human: Fall Flat 的固定 id（后端代理已绑定该游戏） */
export const SPEEDRUN_HFF = { id: SPEEDRUN_GAMES.hff, abbrev: "hff" } as const;

/** 默认拉取的名次数（categoryinfo 场景 Top 15） */
export const LEADERBOARD_TOP = 15;

/** 后端代理基址（同源，经 Vite /api 代理或生产反代到后端） */
const PROXY_BASE = `${restBase}/speedrun`;

/** 代理鉴权令牌（场景页 = URL ?token=；管理端 = auth store token） */
let authToken: string | null = null;

/** 设置后端代理用的 Bearer 令牌（null = 清除；mock 预览无需设置）。 */
export function setSpeedrunToken(token: string | null): void {
  authToken = token;
}

/** 清空前端 speedrun 缓存（双 Map）并使 SWR 冷却全部失效（seq 递增）。 */
export function invalidateSpeedrunCache(): void {
  speedrunRefreshSeq += 1;
  cache.clear();
  swrCache.clear();
}

/**
 * 通知所有已挂载的 speedrun 数据消费方重新拉取。
 * 通过 window 事件、BroadcastChannel 和 localStorage storage 事件三种通道广播，
 * 覆盖同一页面、同源标签页以及 OBS CEF 等场景。
 */
export function requestSpeedrunRefresh(): void {
  invalidateSpeedrunCache();
  globalThis.dispatchEvent(new CustomEvent("twc-speedrun-refresh"));
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const ch = new BroadcastChannel("twc-speedrun-refresh");
      ch.postMessage({ type: "refresh" });
      ch.close();
    }
    localStorage.setItem("twc-speedrun-refresh", String(Date.now()));
  } catch {
    // 隐私模式/配额不足时忽略，window 事件已足够同页刷新
  }
}

// ---------------------------------------------------------------------------
// 错误
// ---------------------------------------------------------------------------

export type SpeedrunErrorKind = "rate-limit" | "http" | "network";

/** speedrun.com 请求失败（限流 420 / 其他非 2xx / 网络不可达） */
export class SpeedrunError extends Error {
  readonly kind: SpeedrunErrorKind;

  constructor(kind: SpeedrunErrorKind, message: string) {
    super(message);
    this.name = "SpeedrunError";
    this.kind = kind;
  }
}

// ---------------------------------------------------------------------------
// 数据形状（仅声明消费的字段）
// ---------------------------------------------------------------------------

/** 分类（per-game 全游戏 / per-level 单关 IL） */
export interface SrCategory {
  id: string;
  name: string;
  type: "per-game" | "per-level";
}

/** 关卡（IL 用） */
export interface SrLevel {
  id: string;
  name: string;
}

/** 变量（is-subcategory 为子分类，榜单需按值过滤否则混合） */
export interface SrVariable {
  id: string;
  name: string;
  isSubcategory: boolean;
  values: { id: string; label: string }[];
}

/** 榜单行（已解析选手名；primary_t 秒口径） */
export interface SrLeaderRow {
  place: number;
  playerName: string;
  /** speedrun.com 用户 id（guest 选手为 null） */
  userId: string | null;
  timeSec: number;
  /** run 提交日期（ISO "YYYY-MM-DD"，可能缺失） */
  date: string | null;
}

/** 用户（绑定解析） */
export interface SrUser {
  id: string;
  name: string;
}

/** 个人最好成绩（当前项目口径；名次可超出榜单 Top N） */
export interface SrPersonalBest {
  place: number;
  timeSec: number;
}

// ---------------------------------------------------------------------------
// 请求与缓存
// ---------------------------------------------------------------------------

interface CacheEntry {
  expiresAt: number;
  promise: Promise<unknown>;
}

const cache = new Map<string, CacheEntry>();
/**
 * 手动刷新计数：作 SWR 冷却失效 token（entry.seq ≠ 当前 seq 即视为冷），
 * 配合双 Map clear() 让下一次调用必发新请求。
 */
let speedrunRefreshSeq = 0;

const TTL_META_MS = 10 * 60_000; // 游戏/变量/用户解析：变更极少
const TTL_LEADERBOARD_MS = 90_000; // 榜单：随 run 提交变动

async function rawGet(path: string): Promise<unknown> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  let resp: Response;
  try {
    resp = await fetch(`${PROXY_BASE}/${path}`, { headers });
  } catch (err) {
    throw new SpeedrunError("network", `speedrun.com 代理请求失败：${String(err)}`);
  }
  if (resp.status === 420) {
    throw new SpeedrunError("rate-limit", "speedrun.com 限流（100 请求/分）");
  }
  if (!resp.ok) {
    // 后端错误体 {"msg": ...}，附进错误信息便于画面诊断
    let msg = `HTTP ${resp.status}`;
    try {
      const body = (await resp.json()) as { msg?: string };
      if (body && typeof body.msg === "string") msg = `${msg} ${body.msg}`;
    } catch {
      // 非 JSON 错误体，忽略
    }
    throw new SpeedrunError("http", msg);
  }
  return (await resp.json()) as unknown;
}

/** 带 TTL 缓存 + 在途去重的 GET（默认 auto 模式，走后端内存 TTL）。 */
function cachedGet<T>(path: string, ttlMs: number, parse: (body: unknown) => T): Promise<T> {
  const hit = cache.get(path);
  const now = Date.now();
  if (hit && hit.expiresAt > now) return hit.promise as Promise<T>;
  // 失败结果不缓存：promise 落空时移除条目，下次重试
  const promise = rawGet(path)
    .then(parse)
    .catch((err: unknown) => {
      cache.delete(path);
      throw err;
    });
  cache.set(path, { expiresAt: now + ttlMs, promise });
  return promise;
}

// ---------------------------------------------------------------------------
// SWR 双请求（stale-while-revalidate）
// ---------------------------------------------------------------------------

/** SWR 双请求的回调钩子（调用方接两段式渲染） */
export interface SwrHooks<T> {
  /** 后端持久化缓存秒回的先上屏值（可能旧）；fetchedAt 为缓存写入时刻（ISO） */
  onCached?: (value: T, fetchedAt: string | null) => void;
  /** refresh 失败诊断通知（返回值不受影响；有缓存兜底时界面不回退） */
  onRefreshError?: (err: unknown) => void;
}

/** SWR 条目：seq ≠ 当前 speedrunRefreshSeq（手动刷新过）即视为冷 */
interface SwrEntry {
  seq: number;
  expiresAt: number;
  promise: Promise<unknown>;
}

/** SWR 路径缓存（key = 原始 path，不含 mode/seq；与 cachedGet 的 cache 互不污染） */
const swrCache = new Map<string, SwrEntry>();

/**
 * SWR GET：并发双请求——
 * ① `mode=cached` 只读后端 Mongo 持久化缓存（秒回；失败静默当作冷缓存），
 *    命中即经 onCached 先上屏。信封 `{fetched_at, data}` 的 data 为 null =
 *    冷缓存（跳过回调）；parse 得 null 是合法负结果（用户未找到/无 PB），
 *    照常回调。
 * ② `mode=refresh` 强制拉上游并让后端比对写回缓存，其解析结果为本函数
 *    返回值，调用方据此替换渲染。失败时回退 ① 的缓存值（保留缓存渲染
 *    不回退），双双失败才抛错（走调用方现有错误分支）。
 * 前端内存 TTL 内（且未手动刷新）直接复用上次 promise，零请求。
 */
function swrGet<T>(
  path: string,
  ttlMs: number,
  parse: (body: unknown) => T,
  hooks?: SwrHooks<T>,
): Promise<T> {
  const entry = swrCache.get(path);
  if (entry && entry.seq === speedrunRefreshSeq && entry.expiresAt > Date.now()) {
    return entry.promise as Promise<T>; // 冷却期：内存直用，零请求
  }
  const q = path.includes("?") ? "&" : "?";
  // ① cached：秒回信封 → onCached 先上屏
  const cachedPromise: Promise<T | null> = rawGet(`${path}${q}mode=cached`)
    .then((body) => {
      const env = asRecord(body);
      const raw = env ? env.data : null;
      if (raw === null || raw === undefined) return null;
      const value = parse(raw);
      const at = env && typeof env.fetched_at === "string" ? env.fetched_at : null;
      hooks?.onCached?.(value, at);
      return value;
    })
    .catch(() => null); // cached 是加速层，失败静默
  // ② refresh：上游原文为权威结果
  const promise: Promise<T> = rawGet(`${path}${q}mode=refresh`)
    .then(parse)
    .catch((err: unknown) => {
      hooks?.onRefreshError?.(err);
      return cachedPromise.then((fallback) => {
        if (fallback !== null) return fallback; // 保留缓存渲染不回退
        throw err; // 无缓存兜底才走错误分支
      });
    });
  swrCache.set(path, { seq: speedrunRefreshSeq, expiresAt: Date.now() + ttlMs, promise });
  promise.catch(() => swrCache.delete(path)); // 双双失败不缓存，下次重试
  return promise;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

function dataOf(body: unknown): unknown {
  return asRecord(body)?.data;
}

// ---------------------------------------------------------------------------
// 公开接口
// ---------------------------------------------------------------------------

/** 一次拉全某游戏的分类与关卡（默认 HFF；管理端映射选择器与自动解析的选项源）。 */
export function fetchHffMeta(
  gameId: string = SPEEDRUN_GAMES.hff,
): Promise<{ categories: SrCategory[]; levels: SrLevel[] }> {
  return cachedGet(
    `game-meta?game_id=${gameId}`,
    TTL_META_MS,
    (body) => {
      const game = asRecord(dataOf(body));
      const cats = asRecord(game?.categories)?.data;
      const lvls = asRecord(game?.levels)?.data;
      const categories: SrCategory[] = Array.isArray(cats)
        ? cats
            .map((c) => asRecord(c))
            .filter((c): c is Record<string, unknown> => c !== null)
            .map(
              (c): SrCategory => ({
                id: String(c.id ?? ""),
                name: String(c.name ?? ""),
                type: c.type === "per-level" ? ("per-level" as const) : ("per-game" as const),
              }),
            )
            .filter((c) => c.id !== "")
        : [];
      const levels: SrLevel[] = Array.isArray(lvls)
        ? lvls
            .map((l) => asRecord(l))
            .filter((l): l is Record<string, unknown> => l !== null)
            .map((l) => ({ id: String(l.id ?? ""), name: String(l.name ?? "") }))
            .filter((l) => l.id !== "")
        : [];
      return { categories, levels };
    },
  );
}

/** 拉某分类或某关卡的变量（含子分类标记与可选值）。 */
export function fetchVariables(scope: {
  categoryId?: string;
  levelId?: string;
}): Promise<SrVariable[]> {
  if (!scope.categoryId && !scope.levelId) return Promise.resolve([]);
  const qs = new URLSearchParams();
  if (scope.categoryId) qs.set("category_id", scope.categoryId);
  if (scope.levelId) qs.set("level_id", scope.levelId);
  return cachedGet(`variables?${qs.toString()}`, TTL_META_MS, (body) => {
    const list = dataOf(body);
    if (!Array.isArray(list)) return [];
    return list
      .map((v) => asRecord(v))
      .filter((v): v is Record<string, unknown> => v !== null)
      .map((v) => {
        const rawValues = asRecord(asRecord(v.values)?.values);
        // 保留 API 列出顺序（首个值 = 该变量的常规/默认板，解析器依赖此约定）
        const values: { id: string; label: string }[] = rawValues
          ? Object.entries(rawValues).map(([id, val]) => ({
              id,
              label: String(asRecord(val)?.label ?? id),
            }))
          : [];
        return {
          id: String(v.id ?? ""),
          name: String(v.name ?? ""),
          isSubcategory: v["is-subcategory"] === true,
          values,
        };
      })
      .filter((v) => v.id !== "");
  });
}

/** 拉项目排行榜（单关传 levelId 走 IL 端点；variables 为子分类过滤；
 *  gameId 默认 HFF，可为 Category Extensions 子游戏）。SWR 双请求：
 *  onCached 秒回持久化缓存先上屏，返回值为上游最新结果。 */
export function fetchLeaderboard(
  q: {
    categoryId: string;
    levelId?: string | null;
    variables?: Record<string, string>;
    top?: number;
    gameId?: string;
  },
  hooks?: SwrHooks<SrLeaderRow[]>,
): Promise<SrLeaderRow[]> {
  const params = new URLSearchParams({
    category_id: q.categoryId,
    game_id: q.gameId ?? SPEEDRUN_GAMES.hff,
    top: String(q.top ?? LEADERBOARD_TOP),
  });
  if (q.levelId) params.set("level_id", q.levelId);
  for (const [varId, valueId] of Object.entries(q.variables ?? {})) {
    if (varId && valueId) params.set(`var-${varId}`, valueId);
  }
  return swrGet(`leaderboard?${params.toString()}`, TTL_LEADERBOARD_MS, (body) => {
    const data = asRecord(dataOf(body));
    const runs = Array.isArray(data?.runs) ? data.runs : [];
    // embed=players 的扁平用户表：id → 展示名（guest 无 id，榜单行内直接取 name）
    const embedded = new Map<string, string>();
    const playersRaw = asRecord(data?.players)?.data;
    if (Array.isArray(playersRaw)) {
      for (const p of playersRaw) {
        const rec = asRecord(p);
        if (!rec) continue;
        const id = typeof rec.id === "string" ? rec.id : null;
        const name = asRecord(rec.names)?.international ?? rec.name;
        if (id && typeof name === "string") embedded.set(id, name);
      }
    }
    const rows: SrLeaderRow[] = [];
    for (const item of runs) {
      const entry = asRecord(item);
      const run = asRecord(entry?.run);
      if (!entry || !run) continue;
      const place = typeof entry.place === "number" ? entry.place : 0;
      const times = asRecord(run.times);
      const timeSec = typeof times?.primary_t === "number" ? times.primary_t : NaN;
      if (place <= 0 || Number.isNaN(timeSec)) continue;
      const players = Array.isArray(run.players) ? run.players : [];
      const names: string[] = [];
      let singleUserId: string | null = null;
      for (const p of players) {
        const rec = asRecord(p);
        if (!rec) continue;
        if (rec.rel === "user" && typeof rec.id === "string") {
          names.push(embedded.get(rec.id) ?? rec.id);
          singleUserId ??= rec.id;
        } else if (typeof rec.name === "string") {
          names.push(rec.name); // guest
        }
      }
      if (names.length === 0) continue;
      const rawDate = run.date;
      rows.push({
        place,
        playerName: names.join(" & "),
        userId: singleUserId,
        timeSec,
        date: typeof rawDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(rawDate)
          ? rawDate.slice(0, 10)
          : null,
      });
    }
    return rows;
  }, hooks);
}

/** 按用户名或 8 位 id 解析 speedrun.com 用户（找不到返回 null，同样缓存避免
 *  反复打接口）。SWR：onCached 先回缓存解析结果（PB 拉取依赖其 userId）。 */
export function resolveUser(
  lookup: string,
  hooks?: SwrHooks<SrUser | null>,
): Promise<SrUser | null> {
  const key = lookup.trim();
  if (!key) return Promise.resolve(null);
  return swrGet(`user?lookup=${encodeURIComponent(key)}`, TTL_META_MS, (body) => {
    const list = dataOf(body);
    if (!Array.isArray(list) || list.length === 0) return null;
    const rec = asRecord(list[0]);
    if (!rec || typeof rec.id !== "string") return null;
    const name = asRecord(rec.names)?.international;
    return { id: rec.id, name: typeof name === "string" ? name : key };
  }, hooks);
}

/**
 * 用户在指定项目的个人最好成绩（personal-bests 按分类 + 关卡 + 子分类值
 * 过滤；名次可超出榜单 Top N——未进 Top 15 也能取到 PB）。无成绩返回 null。
 * SWR 双请求：onCached 秒回持久化缓存（null = 已拉取无成绩，照常回调）。
 */
export function fetchUserPb(
  userId: string,
  board: {
    categoryId: string;
    levelId?: string | null;
    variables?: Record<string, string>;
    gameId?: string;
  },
  hooks?: SwrHooks<SrPersonalBest | null>,
): Promise<SrPersonalBest | null> {
  // 缓存 key 必须含项目参数：解析按项目过滤，同一用户不同项目结果不同
  // （后端 /pb 忽略多余 query，上游响应本身与项目无关）
  const params = new URLSearchParams({
    user_id: userId,
    category_id: board.categoryId,
    game_id: board.gameId ?? SPEEDRUN_GAMES.hff,
  });
  if (board.levelId) params.set("level_id", board.levelId);
  for (const [varId, valueId] of Object.entries(board.variables ?? {})) {
    if (varId && valueId) params.set(`var-${varId}`, valueId);
  }
  return swrGet(`pb?${params.toString()}`, TTL_LEADERBOARD_MS, (body) => {
      const list = dataOf(body);
      if (!Array.isArray(list)) return null;
      const wantVars = board.variables ?? {};
      for (const item of list) {
        const rec = asRecord(item);
        const run = asRecord(rec?.run);
        if (!rec || !run) continue;
        if (String(run.category ?? "") !== board.categoryId) continue;
        const level = typeof run.level === "string" ? run.level : null;
        if (level !== (board.levelId ?? null)) continue;
        const runValues = asRecord(run.values);
        const varsMatch = Object.entries(wantVars).every(
          ([varId, valueId]) => runValues?.[varId] === valueId,
        );
        if (!varsMatch) continue;
        const timeSec = asRecord(run.times)?.primary_t;
        if (typeof timeSec !== "number") continue;
        return { place: typeof rec.place === "number" ? rec.place : 0, timeSec };
      }
      return null;
    }, hooks);
}

/** 清空全部缓存（测试/手动刷新用）。 */
export function clearSpeedrunCache(): void {
  cache.clear();
  swrCache.clear();
}

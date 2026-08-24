/**
 * speedrun.com 数据客户端（管理端图池映射选择器与导播 categoryinfo 场景共用）。
 *
 * - 全部请求走**后端同源代理**（`{restBase}/speedrun/*`，见后端
 *   rest/speedrun_proxy.py）：浏览器 / OBS CEF 直连 speedrun.com 在部分网络
 *   环境不可达（跨域、浏览器扩展、代理策略等），后端统一拉取并做 TTL 缓存
 *   削峰（上游限流 100 请求/分，超限 HTTP 420 原样透传）。
 * - 代理端点需 JWT（调用方先 setSpeedrunToken；场景页传 URL token、管理端
 *   传 auth token；无 token 的 mock 预览不发请求）。
 * - 本模块另按路径缓存（带 TTL）+ 并发去重（同路径在途请求复用同一 Promise）。
 * - 上游资源含义：HFF = Human: Fall Flat（缩写 hff → 固定 id k6qgnmdg）；
 *   用缩写作 id 的上游 URL 会 302，由后端 follow_redirects 跟随。
 */

import { restBase } from "@/api/config";

/** speedrun.com 上 Human: Fall Flat 的固定 id（后端代理已绑定该游戏） */
export const SPEEDRUN_HFF = { id: "k6qgnmdg", abbrev: "hff" } as const;

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
}

/** 用户（绑定解析） */
export interface SrUser {
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// 请求与缓存
// ---------------------------------------------------------------------------

interface CacheEntry {
  expiresAt: number;
  promise: Promise<unknown>;
}

const cache = new Map<string, CacheEntry>();

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

/** 带 TTL 缓存 + 在途去重的 GET；fetcher 从响应体取 data 并解析。 */
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

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

function dataOf(body: unknown): unknown {
  return asRecord(body)?.data;
}

// ---------------------------------------------------------------------------
// 公开接口
// ---------------------------------------------------------------------------

/** 一次拉全 HFF 的分类与关卡（管理端映射选择器选项源）。 */
export function fetchHffMeta(): Promise<{ categories: SrCategory[]; levels: SrLevel[] }> {
  return cachedGet(
    "game-meta",
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
        const values: { id: string; label: string }[] = rawValues
          ? Object.entries(rawValues)
              .map(([id, val]) => ({
                id,
                label: String(asRecord(val)?.label ?? id),
              }))
              .sort((a, b) => a.label.localeCompare(b.label))
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

/** 拉项目排行榜（单关传 levelId 走 IL 端点；variables 为子分类过滤）。 */
export function fetchLeaderboard(q: {
  categoryId: string;
  levelId?: string | null;
  variables?: Record<string, string>;
  top?: number;
}): Promise<SrLeaderRow[]> {
  const params = new URLSearchParams({
    category_id: q.categoryId,
    top: String(q.top ?? LEADERBOARD_TOP),
  });
  if (q.levelId) params.set("level_id", q.levelId);
  for (const [varId, valueId] of Object.entries(q.variables ?? {})) {
    if (varId && valueId) params.set(`var-${varId}`, valueId);
  }
  return cachedGet(`leaderboard?${params.toString()}`, TTL_LEADERBOARD_MS, (body) => {
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
      rows.push({
        place,
        playerName: names.join(" & "),
        userId: singleUserId,
        timeSec,
      });
    }
    return rows;
  });
}

/** 按用户名或 8 位 id 解析 speedrun.com 用户（找不到返回 null，同样缓存避免反复打接口）。 */
export function resolveUser(lookup: string): Promise<SrUser | null> {
  const key = lookup.trim();
  if (!key) return Promise.resolve(null);
  return cachedGet(`user?lookup=${encodeURIComponent(key)}`, TTL_META_MS, (body) => {
    const list = dataOf(body);
    if (!Array.isArray(list) || list.length === 0) return null;
    const rec = asRecord(list[0]);
    if (!rec || typeof rec.id !== "string") return null;
    const name = asRecord(rec.names)?.international;
    return { id: rec.id, name: typeof name === "string" ? name : key };
  });
}

/** 清空全部缓存（测试/手动刷新用）。 */
export function clearSpeedrunCache(): void {
  cache.clear();
}

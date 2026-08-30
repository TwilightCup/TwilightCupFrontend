/**
 * 场景页 URL 参数解析（一次性，挂载时读 location.search）。
 *
 * 各场景页从 URL 取 token / 标识 / 导播配置覆盖值。这些值在挂载即固定，
 * 故返回普通对象即可（非响应式）；导播配置随后由 useDirectorConfig 持久化。
 */
export interface SceneParams {
  /** 登录 JWT（导播控制台生成带入，连 WS / 调 REST 用） */
  token: string;
  /** 比赛会话 id（连 WS 选场、getMyMatch/getMatchLog 用） */
  matchId: string;
  /** 赛事 id（赛程图 / 图池按赛事） */
  tournamentId: string;
  /** 选手 A（蓝）RTMP ingest 地址 */
  /** 选手 A 浏览器可播流（HLS），有则 hls.js / 原生 <video> 播放 */
  hlsA: string;
  /** 选手 B 浏览器可播流（HLS） */
  hlsB: string;
  /** 选手 A 外部直播嵌入地址（B站直播链接走后端代理流；YouTube 走后端 HLS 代理） */
  embedA: string;
  /** 选手 B 外部直播嵌入地址 */
  embedB: string;
  /** 选手 A 场景主题色（HEX） */
  themeA: string;
  /** 选手 B 场景主题色（HEX） */
  themeB: string;
  /** 场景背景样式 key（URL 覆盖，供跨浏览器舞台链接下发） */
  background: string;
  /** 编辑态（=1 唤出导播配置面板） */
  editMode: boolean;
  /** 偏差条满偏对应的计时差（毫秒），默认 60000 */
  gapMs: number;
}

/** 缺省满偏计时差：60s 差 → 偏差条满偏 */
const DEFAULT_GAP_MS = 60_000;

/** 解析当前页面 URL 的场景参数。 */
export function useSceneParams(): SceneParams {
  const p = new URLSearchParams(globalThis.location.search);
  const get = (k: string): string => p.get(k) ?? "";
  return {
    token: get("token"),
    matchId: get("match"),
    tournamentId: get("tournament"),
    hlsA: get("hls_a"),
    hlsB: get("hls_b"),
    embedA: get("embed_a"),
    embedB: get("embed_b"),
    themeA: get("theme_a"),
    themeB: get("theme_b"),
    background: get("background"),
    editMode: p.get("edit") === "1",
    gapMs: parseGap(get("gap")),
  };
}

function parseGap(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_GAP_MS;
  return n;
}

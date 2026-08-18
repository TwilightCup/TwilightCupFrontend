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
  rtmpA: string;
  /** 选手 B（红）RTMP ingest 地址 */
  rtmpB: string;
  /** 选手 A 浏览器可播流（HLS），有则 <video> 直放 */
  hlsA: string;
  /** 选手 B 浏览器可播流（HLS） */
  hlsB: string;
  /** 选手 A PB 文本（单行） */
  pbA: string;
  /** 选手 B PB 文本 */
  pbB: string;
  /** 选手 A 历史速通战绩（多行） */
  histA: string;
  /** 选手 B 历史速通战绩 */
  histB: string;
  /** 编辑态（=1 唤出导播配置面板） */
  editMode: boolean;
  /** 赛事 logo URL（中上展示） */
  logoUrl: string;
  /** 进度条满偏对应的计时差（毫秒），默认 60000 */
  gapMs: number;
}

/** 缺省满偏计时差：60s 差 → 进度条满偏 */
const DEFAULT_GAP_MS = 60_000;

/** 解析当前页面 URL 的场景参数。 */
export function useSceneParams(): SceneParams {
  const p = new URLSearchParams(globalThis.location.search);
  const get = (k: string): string => p.get(k) ?? "";
  return {
    token: get("token"),
    matchId: get("match"),
    tournamentId: get("tournament"),
    rtmpA: get("rtmp_a"),
    rtmpB: get("rtmp_b"),
    hlsA: get("hls_a"),
    hlsB: get("hls_b"),
    pbA: get("pb_a"),
    pbB: get("pb_b"),
    histA: get("hist_a"),
    histB: get("hist_b"),
    editMode: p.get("edit") === "1",
    logoUrl: get("logo"),
    gapMs: parseGap(get("gap")),
  };
}

function parseGap(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_GAP_MS;
  return n;
}

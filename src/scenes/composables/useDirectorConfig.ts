/**
 * 导播场景页配置持久化（RTMP/HLS 流地址）。
 *
 * 仿 src/stores/draft.ts 的 localStorage 模式：按 matchId 键控（无 matchId 用 "_global_"），
 * JSON 序列化，try/catch 容错。导播在编辑面板填一次，刷新 / OBS 重开即恢复。
 *
 * 优先级：URL 参数（rtmp_a 等）若提供 → 作为初值并落库；否则读 localStorage；都没有则空串。
 * 用法：组件 setup 调 const { config, save } = useDirectorConfig(); load(matchId, urlFallbacks)。
 */
import { reactive } from "vue";
import type { SceneParams } from "./useSceneParams";

/** 单场导播配置（每场一份，按 matchId 隔离） */
export interface DirectorConfig {
  rtmpA: string;
  rtmpB: string;
  /** 转码 HLS（m3u8）——自有流媒体服务器输出；hls.js/Safari 可播 */
  hlsA: string;
  hlsB: string;
  /** 外部直播嵌入地址（B站嵌入播放器 / YouTube embed）——iframe 渲染 */
  embedA: string;
  embedB: string;
}

const EMPTY: DirectorConfig = {
  rtmpA: "",
  rtmpB: "",
  hlsA: "",
  hlsB: "",
  embedA: "",
  embedB: "",
};

const PREFIX = "twc-director-cfg";

function key(matchId: string): string {
  return `${PREFIX}:${matchId || "_global_"}`;
}

function read(matchId: string): DirectorConfig {
  try {
    const raw = localStorage.getItem(key(matchId));
    if (!raw) return { ...EMPTY };
    const obj = JSON.parse(raw) as Partial<DirectorConfig>;
    return { ...EMPTY, ...obj };
  } catch {
    return { ...EMPTY };
  }
}

function write(matchId: string, cfg: DirectorConfig): void {
  try {
    localStorage.setItem(key(matchId), JSON.stringify(cfg));
  } catch {
    // 配额满 / 隐私模式，忽略——编辑态本轮仍生效（内存）
  }
}

/**
 * 合并写入某场比赛的配置（非组件上下文用）：WS 收到 config_update 广播时由
 * director store 调——舞台此刻可能不在比赛场景（MatchScene 未挂载读不到），
 * 先落库，之后任意场景挂载 load() 都能读到最新值。
 */
export function mergeStoredConfig(
  matchId: string,
  patch: Partial<DirectorConfig>,
): DirectorConfig {
  const merged = { ...read(matchId), ...patch };
  write(matchId, merged);
  return merged;
}

/**
 * 导播配置：响应式 config + load/save。
 * load 会合并「URL 覆盖 > localStorage > 空」，并把非空 URL 值落库。
 */
export function useDirectorConfig() {
  const config = reactive<DirectorConfig>({ ...EMPTY });

  function load(matchId: string, url: Partial<SceneParams>): void {
    const stored = read(matchId);
    // URL 覆盖：URL 给了非空就用 URL 值，并存库（下次刷新延续）
    const merged: DirectorConfig = {
      rtmpA: url.rtmpA || stored.rtmpA,
      rtmpB: url.rtmpB || stored.rtmpB,
      hlsA: url.hlsA || stored.hlsA,
      hlsB: url.hlsB || stored.hlsB,
      embedA: url.embedA || stored.embedA,
      embedB: url.embedB || stored.embedB,
    };
    Object.assign(config, merged);
    write(matchId, merged);
  }

  function save(matchId: string, patch: Partial<DirectorConfig>): void {
    Object.assign(config, patch);
    write(matchId, { ...config });
  }

  return { config, load, save };
}

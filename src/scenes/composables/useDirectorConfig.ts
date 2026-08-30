/**
 * 导播场景页配置持久化（RTMP/HLS 流地址、画面显隐 / 计时显示延迟等实时控制）。
 *
 * 仿 src/stores/draft.ts 的 localStorage 模式：按 matchId 键控（无 matchId 用 "_global_"），
 * JSON 序列化，try/catch 容错。导播在编辑面板填一次，刷新 / OBS 重开即恢复。
 *
 * 优先级：URL 参数（hls_a 等）若提供 → 作为初值并落库；否则读 localStorage；都没有则空串。
 * 用法：组件 setup 调 const { config, save } = useDirectorConfig(); load(matchId, urlFallbacks)。
 */
import { reactive } from "vue";
import type { SceneParams } from "./useSceneParams";
import {
  DEFAULT_SCENE_BACKGROUND,
  normalizeSceneBackground,
  type SceneBackgroundKey,
} from "./useSceneBackgrounds";

/** 单场导播配置（每场一份，按 matchId 隔离） */
export interface DirectorConfig {
  /** 转码 HLS（m3u8）——自有流媒体服务器输出；hls.js/Safari 可播 */
  hlsA: string;
  hlsB: string;
  /** 外部直播嵌入地址（B站直播间链接/房间号走后端代理 FLV；YouTube 走后端 HLS 代理） */
  embedA: string;
  embedB: string;
  /** 隐藏该侧直播画面（显示等待信号占位；直播中应急，经 config_update 广播） */
  hideA: boolean;
  hideB: boolean;
  /** 重新拉流计数（自增即触发该侧播放器重挂：卡顿时应急刷新） */
  refreshA: number;
  refreshB: number;
  /** 计时显示延迟（秒）：选手画面常有数秒延迟而计时近实时，把该侧计时器
   *  整块（主计时 + 两行副计时）回放对齐画面；0 = 实时直通 */
  delayA: number;
  delayB: number;
  /** 偏差条显示延迟（秒），同上（通常对齐较慢一侧的画面） */
  delayDiff: number;
  /** 选手 A 场景主题色（完全不透明 HEX，#rrggbb） */
  themeA: string;
  /** 选手 B 场景主题色（完全不透明 HEX，#rrggbb） */
  themeB: string;
  /** 场景背景样式（见 useSceneBackgrounds 注册表） */
  background: SceneBackgroundKey;
}

/** 与 scene-theme.css 保持一致的默认主题色 */
export const DEFAULT_THEME_A = "#3d8bff";
export const DEFAULT_THEME_B = "#ff6b4a";

const EMPTY: DirectorConfig = {
  hlsA: "",
  hlsB: "",
  embedA: "",
  embedB: "",
  hideA: false,
  hideB: false,
  refreshA: 0,
  refreshB: 0,
  delayA: 0,
  delayB: 0,
  delayDiff: 0,
  themeA: DEFAULT_THEME_A,
  themeB: DEFAULT_THEME_B,
  background: DEFAULT_SCENE_BACKGROUND,
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
    return {
      ...EMPTY,
      ...obj,
      background: normalizeSceneBackground(obj.background),
    };
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

/** 规范化 HEX：支持 #RGB / #RRGGBB / 无 # 输入，统一为 #rrggbb（不含透明度）。 */
export function normalizeHex(value: string): string {
  const raw = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(raw)) {
    return `#${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`.toLowerCase();
  }
  if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw.toLowerCase()}`;
  return "";
}

/** HEX → rgba()，alpha ∈ [0,1]；非法输入回退默认色。 */
function hexToRgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) {
    return `rgba(61, 139, 255, ${alpha})`;
  }
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i + 1, i + 3), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * 把场景外观（选手主题色）写入 :root CSS 变量。
 * 同时派发 `scene-appearance-change` 事件，供 JS 缓存主题色的组件（如 DiffBar）重读。
 */
export function applySceneAppearance(
  cfg: Partial<Pick<DirectorConfig, "themeA" | "themeB">>,
): void {
  const a = normalizeHex(cfg.themeA ?? "") || DEFAULT_THEME_A;
  const b = normalizeHex(cfg.themeB ?? "") || DEFAULT_THEME_B;
  const root = document.documentElement;
  root.style.setProperty("--syn-a", a);
  root.style.setProperty("--syn-b", b);
  root.style.setProperty("--syn-a-glow", hexToRgba(a, 0.55));
  root.style.setProperty("--syn-b-glow", hexToRgba(b, 0.55));
  root.style.setProperty("--syn-a-glow-soft", hexToRgba(a, 0.25));
  root.style.setProperty("--syn-b-glow-soft", hexToRgba(b, 0.25));
  window.dispatchEvent(new CustomEvent("scene-appearance-change"));
}

/** 从 localStorage 读取并应用某场已保存的场景外观（场景页初始化用）。 */
export function applyStoredAppearance(matchId: string): void {
  applySceneAppearance(read(matchId));
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
  const normalizedPatch: Partial<DirectorConfig> = { ...patch };
  if ("background" in normalizedPatch) {
    normalizedPatch.background = normalizeSceneBackground(normalizedPatch.background);
  }
  const merged = { ...read(matchId), ...normalizedPatch };
  write(matchId, merged);
  applySceneAppearance(merged);
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
      hlsA: url.hlsA || stored.hlsA,
      hlsB: url.hlsB || stored.hlsB,
      embedA: url.embedA || stored.embedA,
      embedB: url.embedB || stored.embedB,
      hideA: stored.hideA,
      hideB: stored.hideB,
      refreshA: stored.refreshA,
      refreshB: stored.refreshB,
      delayA: stored.delayA,
      delayB: stored.delayB,
      delayDiff: stored.delayDiff,
      themeA: url.themeA || stored.themeA,
      themeB: url.themeB || stored.themeB,
      background: normalizeSceneBackground(url.background || stored.background),
    };
    Object.assign(config, merged);
    applySceneAppearance(merged);
    write(matchId, merged);
  }

  function save(matchId: string, patch: Partial<DirectorConfig>): void {
    const normalizedPatch: Partial<DirectorConfig> = { ...patch };
    if ("background" in normalizedPatch) {
      normalizedPatch.background = normalizeSceneBackground(normalizedPatch.background);
    }
    Object.assign(config, normalizedPatch);
    applySceneAppearance(config);
    write(matchId, { ...config });
  }

  return { config, load, save };
}

/**
 * 选图 → speedrun.com 排行榜的自动解析（无显式映射时的默认路径；图池编辑器
 * 配置的 speedrun_* 字段优先生效）。
 *
 * 规则（与杯赛语义对齐）：
 * - 多关（MULTI）：项目名按「选图名称 → 剥离子项目词后的名称 → 合集终点关卡
 *   推断（Aztec/Halloween/Steam/Intro_Reprise → Aztec%/Dark%/Steam%/Any%）」
 *   匹配全游戏分类；CP 类多关不匹配裸项目名，而走 `Checkpoint {项目}`（如
 *   "Dark% CP" → Checkpoint Dark%），再退 Checkpoint%。
 * - 单关（SINGLE）：取合集首关关卡名（**消息级 collection 已展开为关卡名**；
 *   pick.collection 本体仍是关卡库 UUID，别读它）→ 经 officialLevels 的官方
 *   展示名对照（= speedrun.com 的英文本地化关卡名）匹配 IL 关卡；分类固定
 *   per-level 的 PC。CP 类单关（存档点赛）IL 子分类默认 Checkpoint%，其余
 *   默认 Any%。工坊数字 ID 无对应榜单，解析失败回退占位卡。
 * - 子分类：黄昏杯全部项目都是 Solo（全游戏 Checkpoint%/Any% 系子分类默认
 *   Solo）；其余子项目中 Glitchless 从选图标题解析，Checkpoint / Pinch /
 *   No EC 等从 CT 词条解析（词条即 speedrun.com 子分类值名；"No EC" 对应
 *   speedrun.com 的 "No Extended Climb"）。
 */
import { CategoryKind, PickType, type CollectionConfig, type Pick } from "@/api/types";
import {
  fetchHffMeta,
  fetchVariables,
  type SrCategory,
  type SrVariable,
} from "@/api/speedrun";
import { officialDisplayName } from "@/utils/officialLevels";

/** 自动解析结果（与 Pick 的显式映射字段同构） */
export interface ResolvedSpeedrunBoard {
  categoryId: string;
  levelId: string | null;
  variables: Record<string, string>;
}

/** 比较用归一：小写 + 去非字母数字（"Checkpoint%" ≡ "checkpoint"）。 */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function kindOf(pick: Pick): string {
  return (pick.category ?? "").trim().toUpperCase();
}

/** 按名称匹配全游戏分类（归一化全等）。 */
function matchGameCategory(categories: SrCategory[], name: string): SrCategory | null {
  const n = norm(name);
  if (!n) return null;
  return (
    categories.find((c) => c.type === "per-game" && norm(c.name) === n) ?? null
  );
}

/** 合集关卡名序列（消息级 collection 已展开为关卡名；回退 pick 本体）。 */
function collectionLevels(
  pick: Pick,
  collection?: CollectionConfig | null,
): string[] {
  const sources = [collection?.raw, pick.collection?.raw];
  for (const raw of sources) {
    if (!raw || typeof raw !== "object") continue;
    const arr = (raw as { levels?: unknown }).levels;
    if (Array.isArray(arr)) {
      const names = arr.map((x) => (x == null ? "" : String(x))).filter(Boolean);
      if (names.length > 0) return names;
    }
    const single = (raw as { level?: unknown }).level;
    if (typeof single === "string" && single) return [single];
  }
  return [];
}

/** 名称中应剥离的子项目词（匹配项目核心名用；全词匹配，大小写不敏感）。 */
const STRIP_WORDS = [
  "glitchless",
  "pinch",
  "checkpoint",
  "cp",
  "nocp",
  "no checkpoint",
  "no ec",
  "noec",
  "jumpless",
  "solo",
];

/** 剥离名称中的子项目词，得到项目核心名（如 "Aztec% Glitchless" → "Aztec%"）。 */
function stripSubcategoryWords(name: string): string {
  let s = name;
  for (const w of STRIP_WORDS) {
    s = s.replace(new RegExp(`\\b${w.replace(/ /g, "\\s+")}\\b`, "gi"), " ");
  }
  return s.replace(/\s+/g, " ").trim();
}

/** 多关主线终点关卡 → 项目名（与图池编辑器的多关预设对应）。 */
const ENDPOINT_PROJECTS: Readonly<Record<string, string>> = {
  aztec: "Aztec%",
  halloween: "Dark%",
  steam: "Steam%",
  intro_reprise: "Any%",
};

/** 子分类解析线索：标题中的 Glitchless + 全部 CT 词条。 */
function subcategoryTokens(pick: Pick): string[] {
  const tokens: string[] = [];
  if (/glitchless/i.test(pick.name ?? "")) tokens.push("Glitchless");
  tokens.push(...(pick.tags ?? []));
  return tokens;
}

/** 词条/标题别名（speedrun.com 上的正式值名）。 */
const TOKEN_ALIASES: Record<string, string[]> = {
  "No EC": ["No Extended Climb"],
};

/**
 * 为一个子分类变量选值：先按线索精确匹配（含 Solo 前缀与别名——全杯 Solo），
 * 无命中再按 fallbacks 顺序取默认值（CP 单关优先 Checkpoint%；全游戏子分类
 * 的 Solo；IL 的 Any%），仍无则不过滤（如各关自定义的 No Pinch / Glitchless /
 * Pinch 子类，无词条时混榜）。
 */
function chooseValue(
  v: SrVariable,
  tokens: string[],
  fallbacks: string[],
): string | null {
  const byLabel = (label: string): string | null =>
    v.values.find((val) => norm(val.label) === norm(label))?.id ?? null;
  const candidates: string[] = [];
  for (const tok of tokens) {
    candidates.push(tok, `Solo ${tok}`);
    for (const alias of TOKEN_ALIASES[tok] ?? []) {
      candidates.push(alias, `Solo ${alias}`);
    }
  }
  for (const c of candidates) {
    const hit = byLabel(c);
    if (hit) return hit;
  }
  for (const f of fallbacks) {
    const hit = byLabel(f);
    if (hit) return hit;
  }
  return null;
}

/** 拉取作用域内的子分类变量并按线索选值（fallbacks 语义见 chooseValue）。 */
async function resolveVariables(
  categoryId: string,
  levelId: string | null,
  tokens: string[],
  preferCheckpoint: boolean,
): Promise<Record<string, string>> {
  const vars = (await fetchVariables({ categoryId, levelId: levelId ?? undefined })).filter(
    (v) => v.isSubcategory,
  );
  const fallbacks = preferCheckpoint
    ? ["Checkpoint%", "Solo", "Any%"]
    : ["Solo", "Any%"];
  const variables: Record<string, string> = {};
  for (const v of vars) {
    const val = chooseValue(v, tokens, fallbacks);
    if (val) variables[v.id] = val;
  }
  return variables;
}

/** 多关解析：推断项目核心名并匹配全游戏分类（CP 类走 Checkpoint 变体）。 */
function resolveMultiCategory(
  pick: Pick,
  categories: SrCategory[],
  levels: string[],
): SrCategory | null {
  const isCp = kindOf(pick) === CategoryKind.CP;
  // 项目核心名候选：剥离子项目词的名称 + 按合集终点关卡推断（去重保序）
  const stripped = stripSubcategoryWords(pick.name ?? "");
  const endpoint = ENDPOINT_PROJECTS[norm(levels[levels.length - 1] ?? "")] ?? "";
  const cores = [...new Set([stripped, endpoint].filter(Boolean))];
  if (isCp) {
    // CP 多关 = speedrun.com 的 Checkpoint 系全游戏分类；不匹配裸项目名
    for (const core of cores) {
      const hit = matchGameCategory(categories, `Checkpoint ${core}`);
      if (hit) return hit;
    }
    return matchGameCategory(categories, "Checkpoint%");
  }
  const byName = matchGameCategory(categories, pick.name ?? "");
  if (byName) return byName;
  for (const core of cores) {
    const hit = matchGameCategory(categories, core);
    if (hit) return hit;
  }
  return null;
}

/**
 * 自动解析选图对应的 speedrun.com 榜单参数；解析不出（工坊图 / 名称对不上等）
 * 返回 null（场景显示占位卡）。speedrun.com 不可达时抛 SpeedrunError。
 *
 * collection 传 WS 消息级合集（pick_announced / round_start 的 collection，
 * 关卡已展开为名字）；缺省回退 pick.collection（关卡库 UUID，通常匹配不上）。
 */
export async function resolveSpeedrunBoard(
  pick: Pick,
  collection?: CollectionConfig | null,
): Promise<ResolvedSpeedrunBoard | null> {
  const meta = await fetchHffMeta();
  const tokens = subcategoryTokens(pick);
  const levels = collectionLevels(pick, collection);

  if (pick.type === PickType.MULTI) {
    const cat = resolveMultiCategory(pick, meta.categories, levels);
    if (!cat) return null;
    return {
      categoryId: cat.id,
      levelId: null,
      variables: await resolveVariables(cat.id, null, tokens, false),
    };
  }

  // 单关：关卡名 → 官方展示名（= speedrun.com 英文本地化名）→ IL 关卡 + PC 分类
  const lvName = levels[0] ?? "";
  if (!lvName || /^\d+$/.test(lvName)) return null; // 工坊数字 ID 直通，无官方榜单
  const display = officialDisplayName(lvName) ?? lvName;
  const level =
    meta.levels.find((l) => norm(l.name) === norm(display)) ??
    meta.levels.find((l) => norm(l.name) === norm(lvName));
  const cat = meta.categories.find(
    (c) => c.type === "per-level" && norm(c.name) === norm("PC"),
  );
  if (!level || !cat) return null;
  // CP 单关（存档点赛）IL 子分类默认 Checkpoint%
  const preferCheckpoint = kindOf(pick) === CategoryKind.CP;
  return {
    categoryId: cat.id,
    levelId: level.id,
    variables: await resolveVariables(cat.id, level.id, tokens, preferCheckpoint),
  };
}

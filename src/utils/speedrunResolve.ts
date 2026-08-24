/**
 * 选图 → speedrun.com 排行榜的自动解析（无显式映射时的默认路径；图池编辑器
 * 配置的 speedrun_* 字段优先生效）。
 *
 * 规则（与杯赛语义对齐）：
 * - 多关（MULTI）：项目名按「选图名称 → 剥离子项目词后的名称 → 合集终点关卡
 *   推断（Aztec/Halloween/Steam/Intro_Reprise → Aztec%/Dark%/Steam%/Any%）」
 *   匹配全游戏分类。**存档点信号**（CP 类、词条 Checkpoint、名称含
 *   Checkpoint/CP 词）的多关不走裸项目名，而走 `Checkpoint {项目}`（如
 *   "Dark% CP" / "Aztec%"+Checkpoint 词条 → Checkpoint Dark% / Checkpoint
 *   Aztec%），再退 Checkpoint%。
 * - 单关（SINGLE）：取合集首关关卡名（**消息级 collection 已展开为关卡名**；
 *   pick.collection 本体仍是关卡库 UUID，别读它）→ 经 officialLevels 的官方
 *   展示名对照（= speedrun.com 的英文本地化关卡名）匹配 IL 关卡；分类固定
 *   per-level 的 PC。存档点信号的单关（CP 类或 Checkpoint 词条）IL 子分类
 *   取 Checkpoint%，其余默认 Any%。工坊数字 ID 无对应榜单，解析失败回退占位卡。
 * - 子分类：黄昏杯全部项目都是 Solo（全游戏子分类默认 Solo）；其余子项目中
 *   Glitchless 从选图标题解析，Checkpoint / Pinch / No EC 等从 CT 词条解析
 *   （词条即 speedrun.com 子分类值名；"No EC" 对应 "No Extended Climb"）。
 *   无线索命中时取该变量 API 列出的**首个值**（= 常规板：Water Subcategory
 *   首值 Glitches allowed、IL subcategory 首值 Any%、全游戏首值 Solo），
 *   避免不过滤导致 Checkpoint 与 Checkpoint Glitchless 等混合。
 */
import { CategoryKind, PickType, type CollectionConfig, type Pick } from "@/api/types";
import {
  SPEEDRUN_GAMES,
  fetchHffMeta,
  fetchVariables,
  type SrCategory,
  type SrVariable,
} from "@/api/speedrun";
import { officialDisplayName } from "@/utils/officialLevels";

/** 榜单的展示信息（项目名面板用：分类/关卡名 + 已选子分类值标签） */
export interface BoardDisplay {
  categoryName: string;
  levelName: string | null;
  valueLabels: string[];
}

/** 自动解析结果（与 Pick 的显式映射字段同构 + 展示信息；gameId 默认 HFF） */
export interface ResolvedSpeedrunBoard {
  gameId: string;
  categoryId: string;
  levelId: string | null;
  variables: Record<string, string>;
  display: BoardDisplay;
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
 * 无命中再按 fallbacks 顺序取默认值（存档点单关优先 Checkpoint%；全游戏子
 * 分类的 Solo；IL 的 Any%），仍无命中取 API 列出的**首个值**（= 常规板，
 * 避免无过滤时混合 Glitchless 等变体成绩）。
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
  // 常规板 = 该变量列出的首个值（fetchVariables 保留 API 顺序）
  return v.values[0]?.id ?? null;
}

/** 拉取作用域内的子分类变量并按线索选值（fallbacks 语义见 chooseValue）。 */
async function resolveVariables(
  categoryId: string,
  levelId: string | null,
  tokens: string[],
  preferCheckpoint: boolean,
): Promise<{ variables: Record<string, string>; labels: string[] }> {
  const vars = (await fetchVariables({ categoryId, levelId: levelId ?? undefined })).filter(
    (v) => v.isSubcategory,
  );
  const fallbacks = preferCheckpoint
    ? ["Checkpoint%", "Solo", "Any%"]
    : ["Solo", "Any%"];
  const variables: Record<string, string> = {};
  const labels: string[] = [];
  for (const v of vars) {
    const val = chooseValue(v, tokens, fallbacks);
    if (val) {
      variables[v.id] = val;
      const label = v.values.find((s) => s.id === val)?.label;
      if (label) labels.push(label);
    }
  }
  return { variables, labels };
}

/**
 * 多关解析：推断项目核心名并匹配全游戏分类。
 *
 * 存档点信号（CP 类 / 词条 Checkpoint / 名称含 Checkpoint 或 CP 词）的多关
 * 是 Checkpoint 系项目（Checkpoint Aztec% 等），不匹配裸项目名——否则
 * "Aztec%" + Checkpoint 词条会错落到普通 Aztec% 板。
 */
function resolveMultiCategory(
  pick: Pick,
  categories: SrCategory[],
  levels: string[],
  tokens: string[],
): SrCategory | null {
  const wantsCheckpoint =
    kindOf(pick) === CategoryKind.CP ||
    tokens.includes("Checkpoint") ||
    /\b(checkpoint|cp)\b/i.test(pick.name ?? "");
  // 项目核心名候选：剥离子项目词的名称 + 按合集终点关卡推断（去重保序）
  const stripped = stripSubcategoryWords(pick.name ?? "");
  const endpoint = ENDPOINT_PROJECTS[norm(levels[levels.length - 1] ?? "")] ?? "";
  const cores = [...new Set([stripped, endpoint].filter(Boolean))];
  if (wantsCheckpoint) {
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
    // 词条路由：No Checkpoint / Jumpless 多关项目在 Category Extensions 子游戏上
    const extTag = (pick.tags ?? []).find(
      (t) => t === "No Checkpoint" || t === "Jumpless",
    );
    if (extTag) return resolveExtBoard(pick, extTag, levels, tokens);

    const cat = resolveMultiCategory(pick, meta.categories, levels, tokens);
    if (!cat) return null;
    const { variables, labels } = await resolveVariables(cat.id, null, tokens, false);
    return {
      gameId: SPEEDRUN_GAMES.hff,
      categoryId: cat.id,
      levelId: null,
      variables,
      display: { categoryName: cat.name, levelName: null, valueLabels: labels },
    };
  }

  // 单关：关卡名 → 官方展示名（= speedrun.com 英文本地化名）→ IL 关卡 + PC 分类
  const lvName = levels[0] ?? "";
  if (!lvName || /^\d+$/.test(lvName)) return null; // 工坊数字 ID 直通，无官方榜单
  const displayName = officialDisplayName(lvName) ?? lvName;
  const level =
    meta.levels.find((l) => norm(l.name) === norm(displayName)) ??
    meta.levels.find((l) => norm(l.name) === norm(lvName));
  const cat = meta.categories.find(
    (c) => c.type === "per-level" && norm(c.name) === norm("PC"),
  );
  if (!level || !cat) return null;
  // 存档点信号的单关（CP 类或 Checkpoint 词条）IL 子分类取 Checkpoint%
  const preferCheckpoint =
    kindOf(pick) === CategoryKind.CP || tokens.includes("Checkpoint");
  const { variables, labels } = await resolveVariables(
    cat.id,
    level.id,
    tokens,
    preferCheckpoint,
  );
  return {
    gameId: SPEEDRUN_GAMES.hff,
    categoryId: cat.id,
    levelId: level.id,
    variables,
    display: { categoryName: cat.name, levelName: level.name, valueLabels: labels },
  };
}

/**
 * Category Extensions 子游戏解析（No Checkpoint% / Jumpless% 词条项目）。
 * 这两个分类的结构特殊：**项目本身是子分类值**（No CP% subcategory:
 * Aztec% / Any% / …），另有 playermode（Solo 默认）。项目值按名称剥离 /
 * 终点推断的核心名匹配（仅 Any% 兜底），playermode 走常规 Solo 默认。
 */
async function resolveExtBoard(
  pick: Pick,
  extTag: string,
  levels: string[],
  tokens: string[],
): Promise<ResolvedSpeedrunBoard | null> {
  const extMeta = await fetchHffMeta(SPEEDRUN_GAMES.ext);
  const catName = extTag === "No Checkpoint" ? "No Checkpoint%" : "Jumpless%";
  const cat = matchGameCategory(extMeta.categories, catName);
  if (!cat) return null;
  // 项目核心名候选（同多关解析）
  const stripped = stripSubcategoryWords(pick.name ?? "");
  const endpoint = ENDPOINT_PROJECTS[norm(levels[levels.length - 1] ?? "")] ?? "";
  const cores = [...new Set([stripped, endpoint].filter(Boolean))];
  const vars = (await fetchVariables({ categoryId: cat.id })).filter((v) => v.isSubcategory);
  const variables: Record<string, string> = {};
  const labels: string[] = [];
  for (const v of vars) {
    // 值以 % 结尾的变量是项目子分类（Aztec%/Any%…），其余（playermode）常规
    const isProjectVar = v.values.some((s) => s.label.trim().endsWith("%"));
    let valueId: string | null = null;
    if (isProjectVar) {
      const byLabel = (label: string): string | null =>
        v.values.find((s) => norm(s.label) === norm(label))?.id ?? null;
      for (const core of cores) {
        valueId = byLabel(core);
        if (valueId) break;
      }
      valueId ??= byLabel("Any%");
    } else {
      valueId = chooseValue(v, tokens, ["Solo", "Any%"]);
    }
    if (valueId) {
      variables[v.id] = valueId;
      const label = v.values.find((s) => s.id === valueId)?.label;
      if (label) labels.push(label);
    }
  }
  return {
    gameId: SPEEDRUN_GAMES.ext,
    categoryId: cat.id,
    levelId: null,
    variables,
    display: { categoryName: cat.name, levelName: null, valueLabels: labels },
  };
}

/**
 * 由榜单参数反查展示信息（显式映射路径用：ids → 分类/关卡名与子分类值标签；
 * 元数据与变量均有前端缓存，开销可忽略）。
 */
export async function describeBoard(b: {
  gameId?: string;
  categoryId: string;
  levelId: string | null;
  variables: Record<string, string>;
}): Promise<BoardDisplay> {
  const meta = await fetchHffMeta(b.gameId ?? SPEEDRUN_GAMES.hff);
  const categoryName =
    meta.categories.find((c) => c.id === b.categoryId)?.name ?? b.categoryId;
  const levelName = b.levelId
    ? (meta.levels.find((l) => l.id === b.levelId)?.name ?? null)
    : null;
  const vars = (
    await fetchVariables({ categoryId: b.categoryId, levelId: b.levelId ?? undefined })
  ).filter((v) => v.isSubcategory);
  const valueLabels = Object.entries(b.variables)
    .map(([varId, valueId]) => {
      const v = vars.find((x) => x.id === varId);
      return v?.values.find((s) => s.id === valueId)?.label ?? null;
    })
    .filter((x): x is string => x !== null);
  return { categoryName, levelName, valueLabels };
}

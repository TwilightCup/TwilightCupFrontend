/**
 * 官方关卡（BuiltIn 主线 + EditorPick 精选）默认展示资源。
 *
 * - 展示名对照源自 public/LevelIDs.md（关卡 ID → 官方展示名，全量）。
 * - 背景图位于 public/LevelBGs/（构建后为站点根 /LevelBGs/{id}.png），
 *   仅收录实际配了图的关卡（Intro_Reprise / Credits / Museum 等暂无图）。
 * 关卡未自定义展示名 / 展示图时，关卡管理与选图编辑器按此回退；
 * 自定义值（Level.display_name / Level.logo）始终优先。
 */

/** 官方关卡 ID → 展示名（public/LevelIDs.md） */
const OFFICIAL_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  // BuiltIn（主线）
  Intro: "Mansion",
  Train: "Train",
  Carry: "Carry",
  Climb: "Mountain",
  Break: "Demolition",
  Siege: "Castle",
  Water: "Water",
  Power: "Power Plant",
  Aztec: "Aztec",
  Halloween: "Dark",
  Steam: "Steam",
  Ice: "Ice",
  Intro_Reprise: "Reprise",
  Credits: "Credits",
  // EditorPick（精选）
  Thermal: "Thermal",
  Factory: "Factory",
  Golf: "Golf",
  City: "City",
  Forest: "Forest",
  Lab: "Laboratory",
  Lumber: "Lumber",
  RedRock: "Red Rock",
  Tower: "Tower",
  Miniature: "Miniature",
  CopperWorld: "Copper World",
  Naval_Ben: "Port",
  OceanAdventure: "Underwater",
  Dockyard: "Dockyard",
  Museum: "Museum",
  Hike: "Hike",
  Candyland: "Candyland",
  Facility: "Test Chamber",
  SteamPunk: "Steampunk Party",
  Viking: "Viking",
  Anniversary: "10th Anniversary",
};

/** 有官方背景图的关卡 ID（public/LevelBGs/{id}.png） */
const OFFICIAL_BG_IDS: ReadonlySet<string> = new Set([
  "Intro", "Train", "Carry", "Climb", "Break", "Siege", "Water", "Power",
  "Aztec", "Halloween", "Steam", "Ice",
  "Thermal", "Factory", "Golf", "City", "Forest", "Lab", "Lumber", "RedRock",
  "Tower", "Miniature", "CopperWorld", "Naval_Ben", "OceanAdventure", "Dockyard",
]);

/** 官方展示名；非官方关卡（含工坊 ID）返回 null。按关卡名精确匹配。 */
export function officialDisplayName(name: string): string | null {
  return OFFICIAL_DISPLAY_NAMES[name] ?? null;
}

/** 官方背景图 URL；无图的关卡返回 null。按关卡名精确匹配。 */
export function officialLevelBg(name: string): string | null {
  return OFFICIAL_BG_IDS.has(name) ? `/LevelBGs/${name}.png` : null;
}

/** 关卡有效展示名：自定义 display_name > 官方默认 > 关卡名本身。 */
export function levelDisplayNameOf(level: {
  name: string;
  display_name: string;
}): string {
  return level.display_name || officialDisplayName(level.name) || level.name;
}

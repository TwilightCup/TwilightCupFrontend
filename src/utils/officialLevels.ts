/**
 * 官方关卡（BuiltIn 主线 + EditorPick 精选）默认展示名。
 *
 * 对照源自 public/LevelIDs.md（关卡 ID → 官方展示名，全量）。
 * 关卡未自定义展示名时，关卡管理与选图编辑器按此回退；
 * 自定义值（Level.display_name）始终优先。
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

/** 官方展示名；非官方关卡（含工坊 ID）返回 null。按关卡名精确匹配。 */
export function officialDisplayName(name: string): string | null {
  return OFFICIAL_DISPLAY_NAMES[name] ?? null;
}

/** 关卡有效展示名：自定义 display_name > 官方默认 > 关卡名本身。 */
export function levelDisplayNameOf(level: {
  name: string;
  display_name: string;
}): string {
  return level.display_name || officialDisplayName(level.name) || level.name;
}

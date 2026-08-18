/**
 * 展示层格式化与标签映射。
 */
import {
  AccountType,
  AttemptStatus,
  CategoryKind,
  FixtureStatus,
  MatchPhase,
  PickType,
  PlayerStatus,
  RoundSource,
  RoundVerdict,
  ScoringMethod,
  MatchStatus,
  TournamentFormat,
  TournamentStatus,
  type CategoryKind as CategoryKindValue,
  type ScoringMethodName,
} from "@/api/types";
import { t, currentLocaleTag } from "@/locales";

/** Element Plus 标签/按钮主题色取值 */
export type TagType = "primary" | "success" | "info" | "warning" | "danger";

/** 毫秒 → 速通计时 "MM:SS.mmm"（分钟默认两位，≥100 分钟自然进位），null/undefined → "N/A" */
export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return t("format.na");
  const totalMs = Math.max(0, Math.round(ms));
  const m = Math.floor(totalMs / 60_000);
  const s = Math.floor((totalMs % 60_000) / 1000);
  const mmm = totalMs % 1000;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(mmm).padStart(3, "0")}`;
}

/** 选手方标签 */
export function seatLabel(seat: "A" | "B"): string {
  return seat === "A" ? t("seat.a") : t("seat.b");
}

/** 阶段标签 + 主题色 */
export function phaseInfo(phase: MatchPhase): { label: string; type: TagType } {
  switch (phase) {
    case MatchPhase.IDLE:
      return { label: t("phase.idle"), type: "info" };
    case MatchPhase.PREP:
      return { label: t("phase.prep"), type: "warning" };
    case MatchPhase.COUNTDOWN:
      return { label: t("phase.countdown"), type: "danger" };
    case MatchPhase.IN_ROUND:
      return { label: t("phase.inRound"), type: "primary" };
    case MatchPhase.ROUND_JUDGING:
      return { label: t("phase.judging"), type: "danger" };
    case MatchPhase.ROUND_END:
      return { label: t("phase.roundEnd"), type: "success" };
    case MatchPhase.MATCH_END:
      return { label: t("phase.matchEnd"), type: "success" };
    default:
      return { label: t("common.unknown"), type: "info" };
  }
}

/** 选手状态 */
export function playerStatusInfo(status: number): { label: string; type: TagType } {
  switch (status) {
    case PlayerStatus.IN_GAME:
      return { label: t("playerStatus.inGame"), type: "primary" };
    case PlayerStatus.COMPLETED:
      return { label: t("playerStatus.completed"), type: "success" };
    case PlayerStatus.FORFEITED:
      return { label: t("playerStatus.forfeited"), type: "danger" };
    default:
      return { label: t("common.unknown"), type: "info" };
  }
}

/** 判定标签 + 是否该方获胜 */
export function verdictInfo(v: RoundVerdict): {
  label: string;
  type: TagType;
  winner: "A" | "B" | "none";
} {
  switch (v) {
    case RoundVerdict.A_WIN:
      return { label: t("verdict.aWin"), type: "primary", winner: "A" };
    case RoundVerdict.B_WIN:
      return { label: t("verdict.bWin"), type: "danger", winner: "B" };
    case RoundVerdict.TIE_REMATCH:
      return { label: t("verdict.tieRematch"), type: "warning", winner: "none" };
    case RoundVerdict.A_DISCONNECT_LOSS:
      return { label: t("verdict.aDisconnectLoss"), type: "info", winner: "B" };
    case RoundVerdict.B_DISCONNECT_LOSS:
      return { label: t("verdict.bDisconnectLoss"), type: "info", winner: "A" };
    default:
      return { label: t("common.unknown"), type: "info", winner: "none" };
  }
}

export function pickTypeLabel(pk: PickType | number): string {
  return pk === PickType.SINGLE
    ? t("pickType.single")
    : pk === PickType.MULTI
      ? t("pickType.multi")
      : t("common.unknown");
}

export function scoringMethodLabel(
  m: ScoringMethod | ScoringMethodName | undefined,
): string {
  if (m === ScoringMethod.FASTEST || m === "FASTEST") return t("scoring.fastest");
  if (m === ScoringMethod.AVERAGE || m === "AVERAGE") return t("scoring.average");
  return t("common.dash");
}

export function attemptStatusLabel(s: AttemptStatus | number): string {
  switch (s) {
    case AttemptStatus.VALID:
      return t("attemptStatus.valid");
    case AttemptStatus.SKIPPED:
      return t("attemptStatus.skipped");
    case AttemptStatus.UNFINISHED:
      return t("attemptStatus.unfinished");
    case AttemptStatus.INVALID:
      return t("attemptStatus.invalid");
    default:
      return t("common.dash");
  }
}

/** 尝试是否应计入明细展示：有效 / 已跳过（N/A）/ 无效都展示，仅未开始的不展示。 */
export function attemptVisible(s: AttemptStatus | number): boolean {
  return (
    s === AttemptStatus.VALID ||
    s === AttemptStatus.SKIPPED ||
    s === AttemptStatus.INVALID
  );
}

/** 无效原因条目展示（去掉 "!" 前缀，标出可否原谅）。 */
export function invalidReasonLabel(reason: string): string {
  return reason.startsWith("!")
    ? t("attemptStatus.reasonUnforgivable", { reason: reason.slice(1) })
    : t("attemptStatus.reasonForgivable", { reason });
}

/** INVALID 尝试/带标记关卡的原因 tooltip 文案（无原因回退 INVALID 标签）。 */
export function invalidReasonsTitle(
  reasons: string[] | null | undefined,
): string {
  if (!reasons || reasons.length === 0) return t("attemptStatus.invalid");
  return reasons.map(invalidReasonLabel).join(" · ");
}

export function roundSourceLabel(s: RoundSource | number): string {
  return s === RoundSource.REMATCH ? t("roundSource.rematch") : t("roundSource.normal");
}

/** 简短时间（HH:MM:SS） */
export function shortTime(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(currentLocaleTag(), { hour12: false });
}

/** 日期时间（YYYY-MM-DD HH:MM） */
export function dateTime(iso?: string | null): string {
  if (!iso) return t("common.dash");
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return t("common.dash");
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/** 账号类型标签 + 标签色 */
export function accountTypeInfo(
  type: AccountType | number,
): { label: string; type: TagType } {
  switch (type) {
    case AccountType.PLAYER:
      return { label: t("accountType.player"), type: "info" };
    case AccountType.REFEREE:
      return { label: t("accountType.referee"), type: "primary" };
    case AccountType.DIRECTOR:
      return { label: t("accountType.director"), type: "warning" };
    case AccountType.ADMIN:
      return { label: t("accountType.admin"), type: "danger" };
    default:
      return { label: t("common.unknown"), type: "info" };
  }
}

/** 比赛状态标签 + 标签色 */
export function matchStatusInfo(
  status: MatchStatus | number,
): { label: string; type: TagType } {
  switch (status) {
    case MatchStatus.CREATED:
      return { label: t("matchStatus.created"), type: "info" };
    case MatchStatus.RUNNING:
      return { label: t("matchStatus.running"), type: "warning" };
    case MatchStatus.PAUSED:
      return { label: t("matchStatus.paused"), type: "danger" };
    case MatchStatus.ENDED:
      return { label: t("matchStatus.ended"), type: "success" };
    default:
      return { label: t("common.unknown"), type: "info" };
  }
}

/** 图池类别（ML/IL/CP/CT/EX/TB）全称 + 主题色（大小写不敏感，未知→null）。 */
export function categoryKindInfo(
  kind: string | null | undefined,
): { label: string; type: TagType; short: string } | null {
  if (!kind) return null;
  const k = kind.trim().toUpperCase() as CategoryKindValue;
  switch (k) {
    case CategoryKind.ML:
      return { label: t("categoryKind.ml"), type: "primary", short: "ML" };
    case CategoryKind.IL:
      return { label: t("categoryKind.il"), type: "success", short: "IL" };
    case CategoryKind.CP:
      return { label: t("categoryKind.cp"), type: "warning", short: "CP" };
    case CategoryKind.CT:
      return { label: t("categoryKind.ct"), type: "danger", short: "CT" };
    case CategoryKind.EX:
      return { label: t("categoryKind.ex"), type: "info", short: "EX" };
    case CategoryKind.TB:
      return { label: t("categoryKind.tb"), type: "danger", short: "TB" };
    default:
      return null;
  }
}

/** CT 附加词条标签（未知原样返回）。 */
export function ctTagLabel(tag: string): string {
  const key = `ctTag.${tag}`;
  // 仅对已知 tag 取键；未知 tag 原样返回
  const known: string[] = [
    "Glitchless",
    "Pinch",
    "Checkpoint",
    "Jumpless",
    "No Checkpoint",
    "No EC",
    "Achievement",
  ];
  return known.includes(tag) ? t(key) : tag;
}

/** 赛事状态标签 + 标签色 */
export function tournamentStatusInfo(
  status: TournamentStatus | number,
): { label: string; type: TagType } {
  switch (status) {
    case TournamentStatus.DRAFT:
      return { label: t("tournamentStatus.draft"), type: "info" };
    case TournamentStatus.READY:
      return { label: t("tournamentStatus.ready"), type: "info" };
    case TournamentStatus.IN_PROGRESS:
      return { label: t("tournamentStatus.inProgress"), type: "warning" };
    case TournamentStatus.COMPLETED:
      return { label: t("tournamentStatus.completed"), type: "success" };
    case TournamentStatus.CANCELLED:
      return { label: t("tournamentStatus.cancelled"), type: "danger" };
    default:
      return { label: t("common.unknown"), type: "info" };
  }
}

/** 赛制标签 */
export function tournamentFormatLabel(
  format: TournamentFormat | number,
): string {
  switch (format) {
    case TournamentFormat.SINGLE_ELIM:
      return t("tourneyFormat.singleElim");
    case TournamentFormat.DOUBLE_ELIM:
      return t("tourneyFormat.doubleElim");
    case TournamentFormat.SWISS:
      return t("tourneyFormat.swiss");
    default:
      return t("common.dash");
  }
}

/** 对阵节点状态标签 + 标签色 */
export function fixtureStatusInfo(
  status: FixtureStatus | number,
): { label: string; type: TagType } {
  switch (status) {
    case FixtureStatus.PENDING:
      return { label: t("fixtureStatus.pending"), type: "info" };
    case FixtureStatus.READY:
      return { label: t("fixtureStatus.ready"), type: "primary" };
    case FixtureStatus.RUNNING:
      return { label: t("fixtureStatus.running"), type: "warning" };
    case FixtureStatus.COMPLETED:
      return { label: t("fixtureStatus.completed"), type: "success" };
    case FixtureStatus.SKIPPED:
      return { label: t("fixtureStatus.skipped"), type: "info" };
    default:
      return { label: t("common.unknown"), type: "info" };
  }
}

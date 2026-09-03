/**
 * 图池场景数据加载。
 *
 * 数据来源（后端均已签 logo_url，前端无需补签）：
 * 1. matchId 给定 → api.getMyMatch(matchId).mappool（MatchOut.from_match 已签 logo_url）。
 * 2. 仅 tournamentId → api.getMyTournamentMappool（MappoolOut.from_doc 已签 logo_url）。
 * 3. 两者皆无 / 失败 → MOCK_MAPPOOL 兜底（绝不让 OBS 黑屏）。
 * 按 CATEGORY_KINDS 固定顺序展平为 {kind, picks}[]。
 */
import { ref } from "vue";
import { api } from "@/api/client";
import {
  CATEGORY_KINDS,
  type Category,
  type CategoryKind,
  type Mappool,
  type Pick,
} from "@/api/types";
import { MOCK_MAPPOOL } from "@/scenes/mock/mappool";

export interface MappoolGroup {
  kind: CategoryKind;
  picks: Pick[];
  /** CT 类别显式配置的支持词条；None=旧数据未配置。 */
  ctTags?: string[] | null;
}

export function useMappoolData() {
  const groups = ref<MappoolGroup[]>([]);
  const isMock = ref(false);
  const loading = ref(false);

  async function load(token: string, matchId: string, tournamentId: string): Promise<void> {
    if (!token) return;
    loading.value = true;
    try {
      let pool: Mappool | null = null;
      if (matchId) {
        const m = await api.getMyMatch(matchId, token);
        pool = m.mappool ?? null;
      } else if (tournamentId) {
        // 仅给赛事：取该赛事首场已生成比赛的图池（MappoolOut 已签 logo_url）
        pool = (await api.getMyTournamentMappool(tournamentId, token)).mappool ?? null;
      }
      const real = !!pool && !flatten(pool).every((g) => g.picks.length === 0);
      groups.value = flatten(real ? pool! : MOCK_MAPPOOL);
      isMock.value = !real;
    } catch {
      // 403/404 或 token 无效 → mock 兜底（绝不让 OBS 黑屏）
      groups.value = flatten(MOCK_MAPPOOL);
      isMock.value = true;
    } finally {
      loading.value = false;
    }
  }

  return { groups, isMock, loading, load };
}

/** 按 CATEGORY_KINDS 顺序展平图池为分组（未知类别排在最后） */
function flatten(pool: Mappool): MappoolGroup[] {
  interface Bucket {
    picks: Pick[];
    ctTags?: string[] | null;
  }
  const byKind = new Map<CategoryKind, Bucket>();
  for (const k of CATEGORY_KINDS) byKind.set(k, { picks: [], ctTags: null });
  const etc: Pick[] = [];

  for (const cat of pool.categories as Category[]) {
    const kind = (cat.name?.toUpperCase() as CategoryKind) ?? "";
    const bucket = byKind.get(kind);
    if (bucket) {
      bucket.picks.push(...cat.picks);
      bucket.ctTags = cat.ct_tags ?? null;
    } else {
      etc.push(...cat.picks);
    }
  }

  const out: MappoolGroup[] = [];
  for (const k of CATEGORY_KINDS) {
    const bucket = byKind.get(k);
    if (bucket && bucket.picks.length) out.push({ kind: k, picks: bucket.picks, ctTags: bucket.ctTags });
  }
  if (etc.length) out.push({ kind: "EX" as CategoryKind, picks: etc });
  return out;
}

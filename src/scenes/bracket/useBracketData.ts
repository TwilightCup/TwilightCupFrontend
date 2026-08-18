/**
 * 赛程图场景数据加载与编排。
 *
 * 后端 BracketView.build 一次性把比分（score_a/score_b）和选手展示名
 * （player_a_name/b_name）都内嵌进 FixtureOut，前端单次请求拿全，无 N+1、无需名字解析。
 *
 * 流程：
 * 1. 对阵树：api.getMyBracket（GET /me/tournaments/{id}/bracket，赛事成员可读）。
 *    失败（非成员 / token 无效 / 无赛事 / 无 tournamentId）→ MOCK_BRACKET 兜底（绝不让 OBS 黑屏）。
 * 2. 30s 轮询 refresh（对阵推进非 WS 实时）。
 */
import { onUnmounted, ref } from "vue";
import { api } from "@/api/client";
import type { BracketView, FixtureOut } from "@/api/types";
import { MOCK_BRACKET, MOCK_NAMES, MOCK_SCORES } from "@/scenes/mock/bracket";

const POLL_MS = 30_000;

export function useBracketData() {
  const bracket = ref<BracketView | null>(null);
  const isMock = ref(false);
  const loading = ref(false);
  /** fixtureId → {a,b} 比分（从 fixture.score_a/b 提取） */
  const scores = ref<Map<string, { a: number | null; b: number | null }>>(new Map());
  /** accountId → 展示名（从 fixture.player_a_name/b_name 提取） */
  const names = ref<Map<string, string>>(new Map());

  let token = "";
  let timer: ReturnType<typeof setInterval> | null = null;

  async function load(tk: string, tournamentId: string): Promise<void> {
    token = tk;
    if (!token) return;
    loading.value = true;
    try {
      await refresh(tournamentId);
    } finally {
      loading.value = false;
    }
    timer = setInterval(() => void refresh(tournamentId), POLL_MS);
  }

  function stop(): void {
    if (timer) clearInterval(timer);
    timer = null;
  }

  async function refresh(tournamentId: string): Promise<void> {
    let view: BracketView;
    if (!tournamentId) {
      view = MOCK_BRACKET;
      isMock.value = true;
    } else {
      try {
        view = await api.getMyBracket(tournamentId, token);
        isMock.value = false;
      } catch {
        // 非赛事成员 / token 无效 / 无对阵 → mock 兜底
        view = MOCK_BRACKET;
        isMock.value = true;
      }
    }
    bracket.value = view;
    extract(view.rounds.flatMap((r) => r.fixtures));
  }

  /** 从 fixture 直接提取比分（score_a/b）与名字（player_a/b_name） */
  function extract(fixtures: FixtureOut[]): void {
    const sc = new Map<string, { a: number | null; b: number | null }>();
    const nm = new Map<string, string>();
    for (const f of fixtures) {
      if (f.match_id) sc.set(f.id, { a: f.score_a ?? null, b: f.score_b ?? null });
      if (f.player_a_id && f.player_a_name) nm.set(f.player_a_id, f.player_a_name);
      if (f.player_b_id && f.player_b_name) nm.set(f.player_b_id, f.player_b_name);
    }
    // mock 模式：fixture 无 score_a/b（mock 枚举没填），灌 mock 比分 + 名字
    if (isMock.value) {
      for (const [mid, s] of Object.entries(MOCK_SCORES)) sc.set(mid, s);
      for (const [aid, name] of Object.entries(MOCK_NAMES)) nm.set(aid, name);
    }
    scores.value = sc;
    names.value = nm;
  }

  onUnmounted(stop);

  return { bracket, isMock, loading, scores, names, load, stop };
}

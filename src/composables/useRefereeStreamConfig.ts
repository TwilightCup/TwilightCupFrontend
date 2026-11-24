import { computed, reactive } from "vue";
import { useMatchStore } from "@/stores/match";
import { useStreamLinksStore } from "@/stores/streamLinks";

/** Canonical links are read-only; refresh counters belong to this page, not the server. */
export function useRefereeStreamConfig() {
  const match = useMatchStore();
  const shared = useStreamLinksStore();
  const refresh = reactive({ matchId: "", refreshA: 0, refreshB: 0 });
  const config = computed(() => ({ ...shared.linksFor(match.matchId ?? ""),
    refreshA: refresh.matchId === match.matchId ? refresh.refreshA : 0,
    refreshB: refresh.matchId === match.matchId ? refresh.refreshB : 0 }));
  function refreshStream(side: "A" | "B") {
    if (refresh.matchId !== match.matchId) { refresh.matchId = match.matchId ?? ""; refresh.refreshA = refresh.refreshB = 0; }
    refresh[side === "A" ? "refreshA" : "refreshB"]++;
  }
  return { config, refreshStream };
}

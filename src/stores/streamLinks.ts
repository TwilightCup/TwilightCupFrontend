import { defineStore } from "pinia";
import { computed, onScopeDispose, ref } from "vue";
import { api, type ApiError } from "@/api/client";
import type { StreamLinks, StreamLinkValues } from "@/api/types";

export const EMPTY_STREAM_LINKS: StreamLinkValues = { hlsA: "", hlsB: "", embedA: "", embedB: "" };
export const LINK_FIELDS = ["hlsA", "hlsB", "embedA", "embedB"] as const;
export function pickStreamLinks(values: Partial<StreamLinkValues>): StreamLinkValues {
  return { hlsA: values.hlsA ?? "", hlsB: values.hlsB ?? "", embedA: values.embedA ?? "", embedB: values.embedB ?? "" };
}
export function withoutStreamLinks<T extends Partial<StreamLinkValues>>(patch: T): Omit<T, keyof StreamLinkValues> {
  const copy = { ...patch };
  for (const key of LINK_FIELDS) delete copy[key];
  return copy;
}

/** One authorized match per document. No canonical URLs persisted in shared browser storage. */
export const useStreamLinksStore = defineStore("streamLinks", () => {
  const matchId = ref(""), accountId = ref("");
  const snapshot = ref<StreamLinks | null>(null);
  const loading = ref(false), saving = ref(false), unsupported = ref(false), conflict = ref(false);
  const error = ref(""), errorCode = ref("");
  let token = "", generation = 0, read = 0;
  const values = computed(() => pickStreamLinks(snapshot.value ?? EMPTY_STREAM_LINKS));
  const version = computed(() => snapshot.value?.version ?? 0);
  const loaded = computed(() => snapshot.value !== null);

  function clear() {
    generation++; read++; token = ""; matchId.value = accountId.value = "";
    snapshot.value = null; loading.value = saving.value = unsupported.value = conflict.value = false;
    error.value = errorCode.value = "";
  }
  function receive(p: StreamLinks): boolean {
    if (!p || !token || p.match_id !== matchId.value || !Number.isSafeInteger(p.version) || p.version < 0 ||
        LINK_FIELDS.some(key => typeof p[key] !== "string")) return false;
    unsupported.value = false;
    if (snapshot.value && p.version <= snapshot.value.version) return false;
    snapshot.value = { ...p };
    return true;
  }
  function isApiError(e: unknown): e is ApiError { return e instanceof Error && "code" in e && typeof e.code === "number"; }
  function report(e: unknown) {
    error.value = e instanceof Error ? e.message : "读取直播链接失败";
    errorCode.value = isApiError(e) ? e.errorCode ?? "" : "";
    unsupported.value = isApiError(e) && e.code === 404 && !e.errorCode && e.message === "Not Found";
    if (isApiError(e) && (e.code === 401 || e.code === 403 || e.errorCode === "match_not_found")) snapshot.value = null;
  }
  async function refresh() {
    if (!token || !matchId.value) return;
    const scope = generation, attempt = ++read, mid = matchId.value, jwt = token;
    loading.value = true;
    try {
      const p = await api.getStreamLinks(mid, jwt);
      if (scope !== generation || attempt !== read) return;
      receive(p); error.value = errorCode.value = "";
    } catch (e) {
      if (scope === generation && attempt === read) report(e);
    } finally { if (scope === generation && attempt === read) loading.value = false; }
  }
  async function activate(jwt: string, mid: string, aid: string) {
    if (jwt !== token || mid !== matchId.value || aid !== accountId.value) {
      clear(); token = jwt; matchId.value = mid; accountId.value = aid;
    }
    await refresh();
  }
  async function save(draft: StreamLinkValues, expectedVersion: number): Promise<boolean> {
    if (!loaded.value || unsupported.value || saving.value || !token) return false;
    const scope = generation;
    saving.value = true; conflict.value = false; error.value = errorCode.value = "";
    try {
      const p = await api.putStreamLinks(matchId.value, { expected_version: expectedVersion, ...pickStreamLinks(draft) }, token);
      if (scope !== generation) return false;
      receive(p); return true;
    } catch (e) {
      if (scope !== generation) return false;
      report(e);
      if (isApiError(e) && e.errorCode === "stream_links_version_conflict") {
        conflict.value = true;
        const message = error.value, code = errorCode.value;
        await refresh();
        if (scope === generation) { error.value = message; errorCode.value = code; }
      }
      return false;
    } finally { if (scope === generation) saving.value = false; }
  }
  function linksFor(mid: string, legacy: Partial<StreamLinkValues> = EMPTY_STREAM_LINKS): StreamLinkValues {
    if (mid !== matchId.value) return { ...EMPTY_STREAM_LINKS };
    return unsupported.value && !loaded.value ? pickStreamLinks(legacy) : values.value;
  }
  const foreground = () => { if (typeof document === "undefined" || !document.hidden) void refresh(); };
  if (typeof window !== "undefined" && window.addEventListener) {
    window.addEventListener("focus", foreground);
    document.addEventListener?.("visibilitychange", foreground);
    onScopeDispose(() => { window.removeEventListener("focus", foreground); document.removeEventListener?.("visibilitychange", foreground); });
  }
  return { matchId, accountId, values, version, loaded, loading, saving, unsupported, conflict, error, errorCode,
    activate, refresh, receive, save, clear, linksFor };
});

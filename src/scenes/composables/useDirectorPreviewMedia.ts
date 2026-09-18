import { onMounted, onUnmounted, ref } from "vue";
import { PreviewMediaSession } from "../align/previewMediaSession";

/** Keep scene/background/WS mounted; only media components are demand-driven. */
export function useDirectorPreviewMedia() {
  const preview = window.parent !== window && new URLSearchParams(location.search).get("director_preview") === "1";
  const active = ref(!preview);
  const session = new PreviewMediaSession(window.parent, location.origin);
  const receive = (event: MessageEvent) => {
    if (session.receive(event)) active.value = session.active;
  };
  onMounted(() => {
    if (!preview) return;
    window.addEventListener("message", receive);
    window.parent.postMessage({ type: "director-preview-ready" }, location.origin);
  });
  onUnmounted(() => { if (preview) window.removeEventListener("message", receive); });
  return { preview, active };
}

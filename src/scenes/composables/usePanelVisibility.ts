import { computed, onMounted, onUnmounted, ref, watch, type Ref } from "vue";

/** Optical visibility only: never pauses the authority clock or lease driver. */
export function usePanelVisibility(element: Ref<Element | null>) {
  const inView = ref(false);
  const pageVisible = ref(!document.hidden);
  let observer: IntersectionObserver | null = null;
  const visibility = () => { pageVisible.value = !document.hidden; };
  onMounted(() => {
    document.addEventListener("visibilitychange", visibility);
    if (typeof IntersectionObserver !== "undefined") observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.target === element.value) inView.value = entry.isIntersecting;
    });
    if (element.value) { inView.value = !observer; observer?.observe(element.value); }
  });
  watch(element, (next, previous) => {
    if (previous) observer?.unobserve(previous);
    inView.value = !!next && !observer;
    if (next) observer?.observe(next);
  }, { flush: "post" });
  onUnmounted(() => { observer?.disconnect(); document.removeEventListener("visibilitychange", visibility); });
  return computed(() => pageVisible.value && inView.value);
}

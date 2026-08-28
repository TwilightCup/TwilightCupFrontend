/**
 * 响应式值的显示延迟回放（把计时叠加层对齐有延迟的直播画面）。
 *
 * 背景：选手直播画面（HLS / 代理流）通常带数秒延迟，而计时数据经 WS 近实时
 * 同步——画面里的游戏进度与叠加层计时器会错位。导播在控制台按各画面延迟设
 * 秒数（useDirectorConfig 的 delayA/delayB/delayDiff，经 config_update 实时
 * 广播），比赛详情场景用本 composable 把「本该显示的值」回放为 delay 秒前的值。
 *
 * 实现：固定周期采样源值进带时间戳的缓冲，输出 = 最新一条 t ≤ now−delay 的
 * 样本——语义等价「延迟播出的直播流」：
 * - delay = 0 直通源值（保持原有响应即时性；采样照常进行以维持历史缓冲）；
 * - 缓冲常驻保留最大延迟窗口，delay 调大立即向回跳到 delay 秒前（对齐秒调，
 *   无需预热）；调小则向前进到新目标点；
 * - 缓冲尚浅（挂载未满 delay 秒）取最旧样本，播放头停在已缓冲起点随后续走。
 */
import { computed, onBeforeUnmount, ref, type Ref } from "vue";

/** 采样周期：与 useLiveTimers 外推刷新同频（50ms），回放后毫秒位走动颗粒度不变 */
const SAMPLE_MS = 50;
/** 缓冲窗口：覆盖允许的最大延迟（60s，与控制台输入上限一致）+ 1s 余量 */
const WINDOW_MS = 61_000;

/** 非法（NaN / 负数）延迟一律视为 0 */
function sanitizeDelay(ms: number): number {
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

/**
 * 把 source() 的值延迟 delayMs() 毫秒呈现：返回 ref 在 delay > 0 时输出缓冲
 * 回放值，delay ≤ 0 时直通源值。delayMs 读配置（reactive）变化即时生效。
 */
export function useDelayedRef<T>(source: () => T, delayMs: () => number): Ref<T> {
  const direct = computed(source);
  const replay = ref(direct.value) as Ref<T>;
  const buffer: { t: number; v: T }[] = [];

  const timer = window.setInterval(() => {
    const now = Date.now();
    buffer.push({ t: now, v: direct.value });
    while (buffer.length && buffer[0].t < now - WINDOW_MS) buffer.shift();
    const target = now - sanitizeDelay(delayMs());
    // 从尾向前找最新一条不晚于目标时刻的样本；缓冲未覆盖目标时刻时取最旧
    let pick = buffer[0];
    for (let i = buffer.length - 1; i >= 0; i--) {
      if (buffer[i].t <= target) {
        pick = buffer[i];
        break;
      }
    }
    replay.value = pick.v;
  }, SAMPLE_MS);
  onBeforeUnmount(() => window.clearInterval(timer));

  return computed(() => (sanitizeDelay(delayMs()) > 0 ? replay.value : direct.value));
}

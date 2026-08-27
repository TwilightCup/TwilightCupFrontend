/**
 * 多关主计时器实时走表（数据源 live_time，见 ignored/需求-live_time实时计时中转.md）。
 *
 * 选手端每秒上报一次真实计时器读数，两次上报之间本地按墙钟外推
 * （totalMs + 距上次接收的毫秒数）使毫秒位连续走动；新样本到达即以权威
 * 读数重新锚定（每秒矫正一次）。纯前端展示层状态，不回写 store。
 *
 * - 陈旧冻结：超过 STALE_MS 无新样本（插件关闭 / 断线 / 未升级）时冻结在
 *   STALE_MS 外推值上——不归零、不无限外推（需求文档 §5.3），恢复上报自然续走；
 * - 平滑矫正：网络抖动会让新锚点的外推值比已显示值倒退几十毫秒，小倒退
 *   （≤ SMOOTH_MS）保持已显示值等外推追上（计时器不回跳），明显倒退
 *   （回合重置等权威修正）直接跳变采纳；
 * - 样本为 null（回合外 / 一方无上报 / 该席已完赛由上层置 null——完赛即
 *   停表于计时器最终累计读数，杜绝停报后外推多走数秒）该席显示 null，
 *   由上层回退离线口径；
 * - 原地冻结（holdOf，弃权）：可能没有任何完成时间，回退离线累计会把已走
 *   的主计时回跳一大截——保持停表瞬间的读数，不外推不过冲不回跳。
 */
import { onBeforeUnmount, onMounted, ref, type Ref } from "vue";
import type { LiveTime } from "@/stores/director";

/** 无新样本多久判定上报中断并冻结（正常每秒一条，容忍 2 个丢拍） */
const STALE_MS = 3000;
/** 外推刷新周期（主计时毫秒位连续走动的显示帧率，20fps） */
const TICK_MS = 50;
/** 小倒退平滑阈值：倒退不超过此值视为抖动，超过视为重置直接跳变 */
const SMOOTH_MS = 500;

export function useLiveTimers(
  sampleOf: (side: "A" | "B") => LiveTime | null,
  /** 某席是否原地冻结（弃权：无完成时间，保持停表瞬间读数） */
  holdOf?: (side: "A" | "B") => boolean,
): { liveMsA: Ref<number | null>; liveMsB: Ref<number | null> } {
  function makeSide(side: "A" | "B") {
    const liveMs = ref<number | null>(null);
    /** 该席已显示值（小倒退平滑基准；样本消失时复位） */
    let shown: number | null = null;
    return {
      liveMs,
      tick(now: number): void {
        // 原地冻结：跳过本轮全部更新，保持最后一次显示值
        if (holdOf?.(side)) return;
        const s = sampleOf(side);
        if (!s) {
          shown = null;
          liveMs.value = null;
          return;
        }
        let v = s.totalMs + Math.min(Math.max(now - s.receivedAt, 0), STALE_MS);
        if (shown != null && v < shown && shown - v <= SMOOTH_MS) v = shown;
        shown = v;
        liveMs.value = v;
      },
    };
  }

  const sideClockA = makeSide("A");
  const sideClockB = makeSide("B");
  let timer = 0;

  onMounted(() => {
    const tick = (): void => {
      const now = Date.now();
      sideClockA.tick(now);
      sideClockB.tick(now);
    };
    tick();
    timer = window.setInterval(tick, TICK_MS);
  });
  onBeforeUnmount(() => window.clearInterval(timer));

  return { liveMsA: sideClockA.liveMs, liveMsB: sideClockB.liveMs };
}

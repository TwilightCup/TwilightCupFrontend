/**
 * 单侧计时器叠加层锚定虚拟时间 T（§1.3）——替代 useDelayedRef 的整段均匀 delay：
 * 连续计时显示"T 那一时刻"的读数（经 TimerHistory 在 30s+ 落后窗内插值/外推），随 T 的
 * 1x / 2x 追回自然同步到画面。enabled=false（对齐关/无流）时不驱动，由上层回退原
 * useLiveTimers + 手动画行。
 */
import { onBeforeUnmount, onMounted, ref, type Ref } from "vue";
import { alignEngine, type Side } from "@/scenes/align/useFrameAlign";
import { TimerHistory } from "@/scenes/align/timerHistory";
import type { LiveTime } from "@/stores/director";

export interface AlignedTimingCtx {
  /** 本侧是否启用对齐（config.alignX && 有流） */
  enabled: () => boolean;
  /** 叠在 T 上的手动微调偏移（ms，正 = 向更久前看） */
  offsetMs: () => number;
  /** 本侧最近一条 live_time（director.liveTimeOf(side)；无则为 null） */
  liveOf: () => LiveTime | null;
}

export interface AlignedTiming {
  main: Ref<number | null>;
  seg: Ref<number | null>;
  /** true = 本侧处于 T 锚定显示（有样本、T 就绪） */
  active: Ref<boolean>;
}

export function useAlignedTiming(_side: Side, ctx: AlignedTimingCtx): AlignedTiming {
  const hist = new TimerHistory();
  const main = ref<number | null>(null);
  const seg = ref<number | null>(null);
  const active = ref(false);

  let timer = 0;

  onMounted(() => {
    const tick = () => {
      if (!ctx.enabled()) {
        active.value = false;
        main.value = null;
        seg.value = null;
        return;
      }
      const s = ctx.liveOf();
      if (s) hist.add({ receivedAt: s.receivedAt ?? Date.now(), totalMs: s.totalMs, segmentMs: s.segmentMs ?? 0 });
      const T = alignEngine.tUs.value;
      if (T == null || hist.last == null) {
        active.value = false;
        return;
      }
      const tw = T / 1000 + ctx.offsetMs();
      main.value = hist.totalMsAt(tw);
      seg.value = hist.segmentMsAt(tw);
      active.value = true;
    };
    tick();
    timer = window.setInterval(tick, 100);
  });
  onBeforeUnmount(() => window.clearInterval(timer));

  return { main, seg, active };
}
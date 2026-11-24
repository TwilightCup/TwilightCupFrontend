<script setup lang="ts">
/**
 * 对阵树渲染：按轮次分列，列内卡片垂直分布，父列卡片中点对齐子列（标准对阵间距）。
 *
 * 连线：绝对 <svg> 叠层，ResizeObserver 量每张卡 getBoundingClientRect()，
 * 从父卡右中 → 子卡左中画折线（青色 + 辉光）。轮次推进时 N 列卡片数为 N-1 的一半，
 * 故各列内用等分「槽位」(slot) 容器，槽位数 = 该轮卡片数，flex 等分即可让相邻两卡
 * 的中点汇聚到下一列对应卡的中点。
 *
 * 双败：WINNERS(青) / LOSERS(品红) 分组渲染（MAIN 视为胜者组）。
 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  BracketSide,
  type BracketView,
  type BracketRound,
} from "@/api/types";
import { bi } from "@/utils/bilingual";
import FixtureCard from "./FixtureCard.vue";

const props = defineProps<{
  bracket: BracketView;
  scores: Map<string, { a: number | null; b: number | null }>;
  nameOf: (id: string | null) => string;
}>();

/** 按 bracket_side 拆分（MAIN/WINNERS 一组，LOSERS 一组） */
const mainRounds = ref<BracketRound[]>([]);
const losersRounds = ref<BracketRound[]>([]);

function split(): void {
  mainRounds.value = props.bracket.rounds.filter(
    (r) => r.bracket_side !== BracketSide.LOSERS,
  );
  losersRounds.value = props.bracket.rounds.filter(
    (r) => r.bracket_side === BracketSide.LOSERS,
  );
}
watch(() => props.bracket, split, { immediate: true });

// ---- 连线 ----
const mainWrap = ref<HTMLElement | null>(null);
const losersWrap = ref<HTMLElement | null>(null);
const mainPaths = ref("");
const losersPaths = ref("");
let ro: ResizeObserver | null = null;

/** 量卡片，画连线：父列每相邻两卡 → 子列对应一卡 */
function draw(wrapEl: HTMLElement | null, rounds: BracketRound[]): string {
  if (!wrapEl || rounds.length < 2) return "";
  const wrapRect = wrapEl.getBoundingClientRect();
  const cardRects = new Map<string, DOMRect>();
  for (const r of rounds) {
    for (const f of r.fixtures) {
      const el = wrapEl.querySelector<HTMLElement>(`[data-fid="${f.id}"]`);
      if (el) cardRects.set(f.id, el.getBoundingClientRect());
    }
  }
  const segs: string[] = [];
  for (let i = 0; i < rounds.length - 1; i++) {
    const parents = rounds[i].fixtures;
    for (let j = 0; j < parents.length; j += 2) {
      const pa = parents[j];
      const pb = parents[j + 1];
      const child = rounds[i + 1].fixtures[j / 2];
      if (!child) continue;
      const ra = cardRects.get(pa.id);
      const rb = pb ? cardRects.get(pb.id) : null;
      const rc = cardRects.get(child.id);
      if (!ra || !rc) continue;
      // 父卡右中（两父取中）
      const px = ra.right - wrapRect.left;
      const py = rb ? (ra.top + ra.bottom + rb.top + rb.bottom) / 4 - wrapRect.top : (ra.top + ra.bottom) / 2 - wrapRect.top;
      // 子卡左中
      const cx = rc.left - wrapRect.left;
      const cy = (rc.top + rc.bottom) / 2 - wrapRect.top;
      const mx = (px + cx) / 2;
      segs.push(`M ${px} ${py} H ${mx} V ${cy} H ${cx}`);
    }
  }
  return segs.join(" ");
}

function redraw(): void {
  mainPaths.value = draw(mainWrap.value, mainRounds.value);
  losersPaths.value = draw(losersWrap.value, losersRounds.value);
}

function scheduleRedraw(): void {
  void nextTick(redraw);
}

onMounted(() => {
  ro = new ResizeObserver(scheduleRedraw);
  if (mainWrap.value) ro.observe(mainWrap.value);
  if (losersWrap.value) ro.observe(losersWrap.value);
  scheduleRedraw();
});
onBeforeUnmount(() => {
  ro?.disconnect();
  ro = null;
});
watch([mainRounds, losersRounds], scheduleRedraw);

function isCurrent(r: BracketRound): boolean {
  return r.round_no === props.bracket.current_round;
}
function sideTitle(r: BracketRound): string {
  if (r.bracket_side === BracketSide.LOSERS) return bi("scenes.bracket.losers");
  return bi("scenes.bracket.winners");
}
</script>

<template>
  <div class="tree">
    <div class="group winners">
      <h3 class="grp-title neon-text">{{ sideTitle(mainRounds[0]) }}</h3>
      <div ref="mainWrap" class="cols">
        <div v-for="r in mainRounds" :key="r.round_no" class="col" :class="{ current: isCurrent(r) }">
          <div class="col-title">{{ bi('scenes.bracket.roundTitle', { n: r.round_no }) }}</div>
          <div class="slots">
            <div v-for="f in r.fixtures" :key="f.id" class="slot">
              <FixtureCard
                :data-fid="f.id"
                :fixture="f"
                :score="scores.get(f.id) ?? null"
                :name-of="nameOf"
                :is-current="isCurrent(r)"
              />
            </div>
          </div>
        </div>
        <svg class="lines" :width="'100%'" :height="'100%'">
          <path :d="mainPaths" fill="none" stroke="var(--syn-cyan)" stroke-width="2" />
        </svg>
      </div>
    </div>

    <div v-if="losersRounds.length" class="group losers">
      <h3 class="grp-title neon-text-magenta">{{ bi('scenes.bracket.losers') }}</h3>
      <div ref="losersWrap" class="cols">
        <div v-for="r in losersRounds" :key="r.round_no" class="col" :class="{ current: isCurrent(r) }">
          <div class="col-title">{{ bi('scenes.bracket.roundTitle', { n: r.round_no }) }}</div>
          <div class="slots">
            <div v-for="f in r.fixtures" :key="f.id" class="slot">
              <FixtureCard
                :data-fid="f.id"
                :fixture="f"
                :score="scores.get(f.id) ?? null"
                :name-of="nameOf"
                :is-current="isCurrent(r)"
              />
            </div>
          </div>
        </div>
        <svg class="lines" :width="'100%'" :height="'100%'">
          <path :d="losersPaths" fill="none" stroke="var(--syn-magenta)" stroke-width="2" />
        </svg>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tree {
  display: flex;
  flex-direction: column;
  gap: 3vh;
  height: 100%;
}
.group {
  display: flex;
  flex-direction: column;
  gap: 1vh;
  min-height: 0;
}
.winners {
  flex: 1;
}
.losers {
  flex: 0 0 auto;
  max-height: 42%;
}
.grp-title {
  margin: 0;
  font-size: clamp(14px, 1.5vw, 22px);
  font-weight: 800;
  letter-spacing: 1px;
}
.cols {
  position: relative;
  display: flex;
  gap: 4vw;
  align-items: stretch;
  flex: 1;
  min-height: 0;
  padding: 14px 0;
}
.col {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 200px;
}
.col.current .col-title {
  color: var(--syn-win);
}
.col-title {
  font-size: 12px;
  color: var(--syn-text-dim);
  text-align: center;
  letter-spacing: 0.5px;
  padding-bottom: 6px;
}
.slots {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: space-around;
}
.slot {
  display: flex;
  justify-content: center;
}
.lines {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  overflow: visible;
  filter: drop-shadow(0 0 4px rgba(34, 227, 255, 0.6));
}
.losers .lines {
  filter: drop-shadow(0 0 4px rgba(255, 46, 136, 0.6));
}
</style>

<script setup lang="ts">
/**
 * 图池场景页根组件（BP 实时展示版）。
 *
 * 1920×1080 固定画布（16:9），居中呈示并按视口等比缩放（ResizeObserver →
 * transform: scale），容忍微幅宽高比调整不重叠不溢出。
 *
 * 布局：按类别（ML/IL/CP/CT/EX/TB）竖向分带；任一类别选图数 ≥5 → 三列模式
 * （每行至多 3 图、卡片等比收缩），否则双列模式（每行至多 2 图）；每行按本行
 * 卡片数水平居中。行高按总行数在画布内预算分摊（越界大池降级为板内滚动）。
 *
 * 数据：图池 REST（useMappoolData，失败 mock 兜底）+ BP 状态 WS（裁判端
 * draft_sync → 后端广播 draft_state → director.draft，经 useDraftStatus 解析）。
 * hosted（合并舞台）模式下 WS 由舞台根统一连，本组件只读 store。
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";

import { useDirectorStore } from "@/stores/director";
import SynthwaveBg from "@/scenes/components/SynthwaveBg.vue";
import { useSceneContext } from "@/scenes/composables/useSceneContext";
import { useDraftStatus, retryOf } from "./useDraftStatus";
import { useMappoolData, type MappoolGroup } from "./useMappoolData";
import { ctTagsFor } from "@/utils/mappool";
import { bi } from "@/utils/bilingual";
import { MatchPhase, PickType, type CategoryKind, type Pick } from "@/api/types";
import MapCard from "./MapCard.vue";
import CtTagBoard from "./CtTagBoard.vue";

const { t } = useI18n();
const director = useDirectorStore();
const { params, hosted, sharedBg } = useSceneContext();
const { groups, isMock, load } = useMappoolData();

// ---- 画布与布局常量（全部 1920×1080 板内 px，可整体调参） ----
const BOARD_W = 1920;
const BOARD_H = 1080;
const PAD_T = 34;
const PAD_B = 38;
const HEAD_H = 64; // 页标题区（含下间距）
const R_GAP = 10; // 行间距（类别之间同此间距，无类别头）
const CARD_GAP = 24; // 行内卡间距
const MIN_ROW_H = 46;
const MAX_ROW_H = 112;
/** 任一类别选图数达到该值 → 三列模式 */
const THREE_COL_MIN = 5;

interface GroupLayout {
  kind: CategoryKind;
  rows: Pick[][];
}

/** 动态列数：所有类别中单类别最大选图数 ≥5 → 3 列，否则 2 列 */
const cols = computed(() => {
  const max = Math.max(0, ...groups.value.map((g) => g.picks.length));
  return max >= THREE_COL_MIN ? 3 : 2;
});
const colsClass = computed(() => (cols.value === 3 ? "cols-3" : "cols-2"));

const layout = computed<GroupLayout[]>(() =>
  groups.value.map((g: MappoolGroup) => ({
    kind: g.kind,
    rows: chunk(g.picks, cols.value),
  })),
);

const totalRows = computed(
  () =>
    layout.value.reduce((n, g) => n + g.rows.length, 0) +
    (groups.value.some((g) => g.kind === "CT") ? 1 : 0), // CT 词条板占一行
);

/** CT 候选词条：CT_TAG_BASE + （类别内含单关图时）Achievement */
const ctCandidates = computed(() => {
  const ct = groups.value.find((g) => g.kind === "CT");
  if (!ct) return [];
  const hasSingle = ct.picks.some((p) => p.type === PickType.SINGLE);
  return ctTagsFor(hasSingle);
});

// ---- BP 状态（WS draft_state → director.draft） ----
const draftStatus = useDraftStatus(computed(() => director.draft));
/** 词条板高亮：当前回合 pick 携带的词条。回合结束（ROUND_END / MATCH_END，
 *  含裁判强制结束）即复位——需求「回合重置」，下一轮 pick 后重新点亮。 */
const activePickTags = computed(() => {
  if (
    director.phase === MatchPhase.ROUND_END ||
    director.phase === MatchPhase.MATCH_END ||
    director.phase === MatchPhase.IDLE
  ) {
    return [];
  }
  const code = draftStatus.value.activePickCode;
  return code ? (draftStatus.value.pickedTagsByCode.get(code) ?? []) : [];
});
const activePickSide = computed(() => {
  const code = draftStatus.value.activePickCode;
  return code ? (draftStatus.value.statusByCode.get(code)?.by ?? null) : null;
});

/** 行区可用高度（扣去页标题；类别间无头、间距同行距） */
const availForRowArea = computed(() => BOARD_H - PAD_T - PAD_B - HEAD_H);

const rowH = computed(() => {
  if (!totalRows.value) return MIN_ROW_H;
  const per = (availForRowArea.value - (totalRows.value - 1) * R_GAP) / totalRows.value;
  return Math.min(MAX_ROW_H, Math.max(MIN_ROW_H, Math.floor(per)));
});
/** 极端大池：最小行高仍放不下 → 板内滚动降级 */
const overflowing = computed(
  () => totalRows.value > 0 && availForRowArea.value / totalRows.value < MIN_ROW_H,
);

function chunk(picks: Pick[], n: number): Pick[][] {
  const rows: Pick[][] = [];
  for (let i = 0; i < picks.length; i += n) rows.push(picks.slice(i, i + n));
  return rows;
}

// ---- 16:9 画布等比缩放（视口 ResizeObserver；老环境兜底 window resize） ----
const wrapEl = ref<HTMLElement | null>(null);
const scale = ref(0);
let ro: ResizeObserver | null = null;
let onWinResize: (() => void) | null = null;

/** 画布安全边：贴边 scale 会因亚像素取整被裁 1~2px，留少量呼吸空间 */
const BOARD_MARGIN = 24;

function updateScale(w: number, h: number): void {
  scale.value = Math.min((w - BOARD_MARGIN) / BOARD_W, (h - BOARD_MARGIN) / BOARD_H);
}

onMounted(() => {
  void load(params.token, params.matchId, params.tournamentId);
  // hosted（合并舞台）模式下 WS 由舞台根统一连，场景只读 store；否则自己连
  if (!hosted && params.token && params.matchId) {
    director.connect(params.token, params.matchId);
  }

  if (wrapEl.value) {
    // 先同步测一次（RO 首回调异步，避免首帧以未缩放画布闪现溢出）
    updateScale(wrapEl.value.clientWidth, wrapEl.value.clientHeight);
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver((entries) => {
        const r = entries[0].contentRect;
        updateScale(r.width, r.height);
      });
      ro.observe(wrapEl.value);
    } else {
      onWinResize = () => updateScale(globalThis.innerWidth, globalThis.innerHeight);
      onWinResize();
      window.addEventListener("resize", onWinResize);
    }
  }
});
onUnmounted(() => {
  ro?.disconnect();
  if (onWinResize) window.removeEventListener("resize", onWinResize);
  if (!hosted) director.disconnect();
});
</script>

<template>
  <div class="scene scanlines">
    <SynthwaveBg v-if="!sharedBg" />

    <div v-if="!params.token" class="notice">
      <div class="notice-card neon-panel">{{ t("scenes.noToken") }}</div>
    </div>

    <template v-else>
      <!-- 视口（缩放测量基准）→ 居中 16:9 画布 -->
      <div ref="wrapEl" class="viewport">
        <div
          class="board"
          :style="{ transform: `translate(-50%, -50%) scale(${scale})` }"
        >
          <header class="head">
            <h1 class="title neon-text">{{ bi("scenes.mappool.title") }}</h1>
          </header>

          <div class="pool" :class="[colsClass, { overflowing }]">
            <section v-for="g in layout" :key="g.kind" class="group">
              <div class="rows">
                <div
                  v-for="(row, i) in g.rows"
                  :key="i"
                  class="row"
                  :style="{ '--row-h': `${rowH}px`, gap: `${CARD_GAP}px` }"
                >
                  <MapCard
                    v-for="p in row"
                    :key="p.code"
                    :pick="p"
                    :kind="g.kind"
                    :status="draftStatus.statusByCode.get(p.code) ?? null"
                    :retry="retryOf(draftStatus, p)"
                  />
                </div>
                <!-- CT 词条板：整个类别下方一条横幅卡，后续类别自然下移 -->
                <div
                  v-if="g.kind === 'CT'"
                  class="row"
                  :style="{ '--row-h': `${rowH}px` }"
                >
                  <CtTagBoard
                    :candidates="ctCandidates"
                    :banned-tags="draftStatus.bannedTags"
                    :tag-ban-by="draftStatus.tagBanBy"
                    :picked-tags="activePickTags"
                    :pick-side="activePickSide"
                  />
                </div>
              </div>
            </section>
            <div v-if="layout.length === 0" class="empty">
              {{ bi("scenes.mappool.empty") }}
            </div>
          </div>
        </div>
      </div>

      <div v-if="isMock" class="mock-badge">{{ t("scenes.mockBadge") }}</div>
    </template>
  </div>
</template>

<style scoped>
.scene {
  position: relative;
  height: 100%;
}
.viewport {
  position: absolute;
  inset: 0;
  /* 卡片层压过全部背景元素（SynthwaveBg z-index:0；仍在扫描线 z-50 之下） */
  z-index: 20;
  overflow: hidden;
}
/* 固定 1920×1080 画布：绝对居中 + 等比缩放（--card-w 按列数给行内卡片宽度） */
.board {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 1920px;
  height: 1080px;
  padding: 34px 56px 38px;
  display: flex;
  flex-direction: column;
}
.head {
  height: 64px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
}
.title {
  margin: 0;
  font-size: 44px;
  font-weight: 900;
  letter-spacing: 3px;
}
.pool {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px; /* 类别之间与行距一致，整体紧凑 */
  /* 卡片贴合标题后整体变矮，块在画布内垂直居中 */
  justify-content: center;
}
.pool.overflowing {
  overflow-y: auto;
  /* 居中 + 滚动会裁掉顶部，溢出降级时回到顶部对齐 */
  justify-content: flex-start;
}
.group {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
}
.rows {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
/* 每行按本行卡片数水平居中 */
.row {
  display: flex;
  justify-content: center;
}
/* 动态列数：卡片等宽（3 列模式等比收缩）；挂在 .row 上，选图卡与 CT 词条板同宽 */
.pool.cols-2 .row {
  --card-w: calc((100% - 24px) / 2);
}
.pool.cols-3 .row {
  --card-w: calc((100% - 48px) / 3);
}
.empty {
  color: var(--syn-text-dim);
  text-align: center;
  padding: 200px 0;
  font-size: 22px;
}
.notice {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.notice-card {
  padding: 24px 32px;
  font-size: 15px;
}
</style>

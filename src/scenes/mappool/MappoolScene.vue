<script setup lang="ts">
/**
 * 图池场景页根组件（BP 实时展示版）。
 *
 * 1920×1080 固定画布（16:9），居中呈示并按视口等比缩放（ResizeObserver →
 * transform: scale），容忍微幅宽高比调整不重叠不溢出。
 *
 * 布局：顶部信息栏 TopBar（选手/比分/赛事·比赛标题，需求见顶栏文档）——
 * 视口坐标铺顶、不随画布缩放（与比赛详情页同尺寸同位置），其下按类别
 * （ML/IL/CP/CT/EX/TB）竖向分带整体靠上；任一类别选图
 * 数 ≥5 → 三列模式（每行至多 3 图、卡片等比收缩），否则双列模式（每行至多
 * 2 图）；每行按本行卡片数水平居中。行高按总行数在画布内预算分摊（扣顶栏
 * 占位；越界大池降级为板内滚动）。左下角为比赛聊天区（样式对齐管理端日志
 * 单行聊天）。
 *
 * 数据：图池 REST（useMappoolData，失败 mock 兜底）+ BP 状态 WS（裁判端
 * draft_sync → 后端广播 draft_state → director.draft，经 useDraftStatus 解析）。
 * hosted（合并舞台）模式下 WS 由舞台根统一连，本组件只读 store。
 */
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { useDirectorStore, type DirectorChatLine } from "@/stores/director";
import SynthwaveBg from "@/scenes/components/SynthwaveBg.vue";
import TopBar from "@/scenes/components/TopBar.vue";
import { useSceneContext } from "@/scenes/composables/useSceneContext";
import { useDraftStatus, retryOf } from "./useDraftStatus";
import { useMappoolData, type MappoolGroup } from "./useMappoolData";
import { ctTagsFor } from "@/utils/mappool";
import { shortTime } from "@/utils/format";
import { bi } from "@/utils/bilingual";
import { MatchPhase, PickType, type CategoryKind, type Pick } from "@/api/types";
import MapCard from "./MapCard.vue";
import CtTagBoard from "./CtTagBoard.vue";

const { t } = useI18n();
const director = useDirectorStore();
const { params, hosted, sharedBg, sharedTopBar } = useSceneContext();
const { groups, isMock, load } = useMappoolData();

// ---- 画布与布局常量（全部 1920×1080 板内 px，可整体调参） ----
const BOARD_W = 1920;
const BOARD_H = 1080;
/** 池内容与顶栏的间隙（画布坐标系；顶栏不随画布缩放） */
const PAD_T = 34;
/** 行高预算按整幅画布扣上下边距（聊天是左下角悬浮层，不占行高预算） */
const PAD_B = 38;
/** 顶部信息栏视口占位：高 104 + 与池内容的间距 18（与 TopBar 组件高度配对） */
const TOPBAR_BLOCK = 122;
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
/** code → 选图所属类别 kind（词条板只对 CT 选图的词条作出反应） */
const kindByCode = computed(() => {
  const m = new Map<string, CategoryKind>();
  for (const g of groups.value) for (const p of g.picks) m.set(p.code, g.kind);
  return m;
});
/** 词条板高亮：当前回合 pick 携带的词条（仅 CT 选图——非 CT 选图即便带有
 * tag 字段也不点亮）。回合结束（ROUND_END / MATCH_END，含裁判强制结束）即
 * 复位——需求「回合重置」，下一轮 pick 后重新点亮。卡片右下角的词条角标
 * 不走此门控，见 cardPickedTags。 */
const activePickTags = computed(() => {
  if (
    director.phase === MatchPhase.ROUND_END ||
    director.phase === MatchPhase.MATCH_END ||
    director.phase === MatchPhase.IDLE
  ) {
    return [];
  }
  const code = draftStatus.value.activePickCode;
  if (!code || kindByCode.value.get(code) !== "CT") return [];
  return draftStatus.value.pickedTagsByCode.get(code) ?? [];
});
const activePickSide = computed(() => {
  const code = draftStatus.value.activePickCode;
  return code ? (draftStatus.value.statusByCode.get(code)?.by ?? null) : null;
});
/** 本卡被 pick 时携带的词条（仅 CT；整场持久显示，不随回合重置——区别于
 *  词条板的「回合复位」，与 ban/pick 终态同为整场有效） */
function cardPickedTags(code: string): string[] {
  if (kindByCode.value.get(code) !== "CT") return [];
  return draftStatus.value.pickedTagsByCode.get(code) ?? [];
}

// ---- 左下角聊天区（实时 WS 流；样式对齐管理端日志的单行聊天） ----
/** 渲染窗口：可见区约 5 行，多持几行供顶部同边距截断显示与上滚动效 */
const CHAT_HOLD = 12;
/** 合并窗：新到消息先等该窗口收集近同时到达的伙伴（如聊天命令 + 服务器
 *  反馈），到点作为一批一次滚出；动画进行中再到的消息经 FLIP 从当前位置
 *  平滑并入正在进行的滚动，视觉上与既有新消息一起滚出来 */
const CHAT_COALESCE_MS = 150;
const shownChat = ref<DirectorChatLine[]>([]);
/** 已观察（入过队）的最大 id：每次 watcher 触发即更新——合并窗内多次触发
 *  才不会把早前已入队的消息重复收集（重复 key 会渲染两份） */
let lastSeenId = 0;
let pendingChat: DirectorChatLine[] = [];
let chatFlushTimer: ReturnType<typeof setTimeout> | null = null;

/** 初始装载存量（appear 播整块升起进场），此后增量走批量调度 */
shownChat.value = director.chatLines.slice(-CHAT_HOLD);
lastSeenId = shownChat.value[shownChat.value.length - 1]?.id ?? 0;

function flushPendingChat(): void {
  chatFlushTimer = null;
  if (!pendingChat.length) return;
  const batch = pendingChat;
  pendingChat = [];
  shownChat.value.push(...batch);
  if (shownChat.value.length > CHAT_HOLD) {
    shownChat.value.splice(0, shownChat.value.length - CHAT_HOLD);
  }
}

watch(
  () => director.chatLines.length,
  () => {
    const fresh = director.chatLines.filter((l) => l.id > lastSeenId);
    if (!fresh.length) return;
    lastSeenId = fresh[fresh.length - 1]!.id;
    pendingChat.push(...fresh);
    // 首条到时开合并窗；窗内后续到达共用同一次 flush（整批一次滚出）
    if (!chatFlushTimer) {
      chatFlushTimer = setTimeout(flushPendingChat, CHAT_COALESCE_MS);
    }
  },
);
/** 名字着色类（与管理端一致：A 蓝 / B 橙 / 裁判黄 / 其余灰） */
function senderClass(line: DirectorChatLine): string {
  if (line.kind === "system") return "sys";
  switch (line.seat) {
    case "PLAYER_A":
      return "pa";
    case "PLAYER_B":
      return "pb";
    case "REFEREE":
      return "ref";
    default:
      return "sys";
  }
}

/** 池内容画布坐标顶部偏移：顶栏不随画布缩放（视口坐标铺顶，与比赛详情页
 *  同尺寸），画布内等效占位 = TOPBAR_BLOCK / scale，再加 PAD_T 间隙。
 *  scale 未测得时用未缩放值兜底（首帧同步测一次后即被覆盖） */
const poolTop = computed(() =>
  scale.value > 0 ? Math.ceil(TOPBAR_BLOCK / scale.value) + PAD_T : TOPBAR_BLOCK + PAD_T,
);

/** 行区可用高度（扣顶栏占位与上下边距；类别间无头、间距同行距） */
const availForRowArea = computed(() => BOARD_H - poolTop.value - PAD_B);

const rowH = computed(() => {
  if (!totalRows.value) return MIN_ROW_H;
  const per = (availForRowArea.value - (totalRows.value - 1) * R_GAP) / totalRows.value;
  return Math.min(MAX_ROW_H, Math.max(MIN_ROW_H, Math.floor(per)));
});
/** 极端大池：最小行高仍放不下 → 板内滚动降级 */
const overflowing = computed(
  () => totalRows.value > 0 && availForRowArea.value / totalRows.value < MIN_ROW_H,
);

/** 内容底部贴聊天盒顶沿时距画布底部的距离：聊天底距 12 + 满高 199 + 空隙 16
 *  （与 CSS .chat-box 的 bottom/height 配对）。行高预算仍按整幅画布（PAD_B=38），
 *  聊天不占行高——内容装得下才下沉贴靠，装不下自动回顶部对齐避免裁顶。 */
const CHAT_TOP_RESERVE = 227;
/** 行的实际渲染高度占行预算的比例（与 MapCard --card-h / CtTagBoard .tag-board
 *  的高度算式配对）——rowH 只是布局预算，行盒真实高度是它的比例折算 */
const CARD_H_RATIO = 0.75;
const TAGBOARD_H_RATIO = 0.92;
/** 图池整体下沉：最下行底部贴近聊天盒顶部（按真实渲染高度判定装不装得下） */
const pinnedToChat = computed(() => {
  if (!totalRows.value || overflowing.value) return false;
  const hasCtBoard = groups.value.some((g) => g.kind === "CT");
  const cardRows = totalRows.value - (hasCtBoard ? 1 : 0);
  const contentH =
    cardRows * rowH.value * CARD_H_RATIO +
    (hasCtBoard ? rowH.value * TAGBOARD_H_RATIO : 0) +
    (totalRows.value - 1) * R_GAP;
  return contentH <= BOARD_H - poolTop.value - CHAT_TOP_RESERVE;
});

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

function updateScale(w: number, h: number): void {
  vpW.value = w;
  vpH.value = h;
  // 满幅缩放（无安全边）：画布外缘本就无可见内容（池有 56/38 内边距、聊天卡
  // 距边 12px），亚像素裁 1~2px 无碍。此前 24px 安全边在 16:9 下造成横 21 /
  // 纵 12 的不等留白，使聊天卡侧/底边距不等，已去除
  scale.value = Math.min(w / BOARD_W, h / BOARD_H);
  // 变换应用后量一次画布与聊天盒屏幕坐标（自检读数用；双 rAF 确保渲染后）
  if (debugGeo) {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const snap = (
          el: HTMLElement | null,
        ): { l: number; t: number; r: number; b: number } | null => {
          const r = el?.getBoundingClientRect();
          return r
            ? {
                l: Math.round(r.left),
                t: Math.round(r.top),
                r: Math.round(r.right),
                b: Math.round(r.bottom),
              }
            : null;
        };
        boardRect.value = snap(boardEl.value);
        chatRect.value = snap(chatEl.value);
      }),
    );
  }
}

// ---- ?debug=1 几何自检：伪元素边框显示 16:9 画布实际边界，读出视口/缩放/
//      留白与画布屏幕坐标（outline 在 transform 元素上可能不绘制，故用伪元素） ----
const debugGeo = new URLSearchParams(globalThis.location.search).has("debug");
const vpW = ref(0);
const vpH = ref(0);
const letterbox = computed(() => ({
  x: Math.max(0, (vpW.value - BOARD_W * scale.value) / 2),
  y: Math.max(0, (vpH.value - BOARD_H * scale.value) / 2),
}));
/** 画布在视口内的屏幕坐标（缩放变换后的真实落点） */
const boardEl = ref<HTMLElement | null>(null);
const boardRect = ref<{ l: number; t: number; r: number; b: number } | null>(null);
/** 聊天盒屏幕坐标（对照 board 坐标即可判定它挂在哪个包含块上） */
const chatEl = ref<HTMLElement | null>(null);
const chatRect = ref<{ l: number; t: number; r: number; b: number } | null>(null);

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
  if (chatFlushTimer) clearTimeout(chatFlushTimer);
  if (!hosted) director.disconnect();
});
</script>

<template>
  <div class="scene">
    <SynthwaveBg v-if="!sharedBg" />

    <div v-if="!params.token" class="notice">
      <div class="notice-card neon-panel">{{ t("scenes.noToken") }}</div>
    </div>

    <template v-else>
      <!-- 视口（缩放测量基准）→ 居中 16:9 画布 -->
      <div ref="wrapEl" class="viewport">
        <div
          ref="boardEl"
          class="board"
          :class="{ 'debug-outline': debugGeo }"
          :style="{ transform: `translate(-50%, -50%) scale(${scale})` }"
        >
          <div
            class="pool"
            :class="[colsClass, { overflowing, pinned: pinnedToChat }]"
            :style="{ marginTop: `${poolTop}px` }"
          >
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
                    :protected-by="draftStatus.protectedByCode.get(p.code) ?? null"
                    :retry="retryOf(draftStatus, p)"
                    :picked-tags="cardPickedTags(p.code)"
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

          <!-- 左下角比赛聊天：固定满尺寸常显，消息底部锚定、顶部同边距截断，
               新消息自底部滑入并推动整块上滚（TransitionGroup FLIP；
               appear 使切场景重挂载时存量消息也从底部升起） -->
          <aside ref="chatEl" class="chat-box">
            <TransitionGroup tag="div" class="chat-lines" name="chat" appear>
              <div
                v-for="line in shownChat"
                :key="line.id"
                class="chat-line"
                :class="{ sys: line.kind === 'system' }"
              >
                <span class="cl-time">{{ shortTime(line.ts) }}</span>
                <span class="cl-name" :class="`cl-${senderClass(line)}`">{{ line.sender }}</span>
                <span class="cl-text">{{ line.text }}</span>
              </div>
            </TransitionGroup>
          </aside>
        </div>

        <!-- 顶部信息栏：视口坐标铺顶、不随画布缩放（与比赛详情页同尺寸同位置）；
             位于画布之上，池顶部已按 scale 动态让位（脚本 poolTop）。
             hosted 模式下舞台常驻单实例顶栏（sharedTopBar），此处不渲染 -->
        <TopBar v-if="!sharedTopBar" class="view-top" />
      </div>

      <div v-if="isMock" class="mock-badge">{{ t("scenes.mockBadge") }}</div>

      <!-- 几何自检：视口尺寸 / 缩放比 / 横纵留白 / 画布与聊天盒屏幕坐标（黄框=16:9 画布） -->
      <div v-if="debugGeo" class="debug-geo">
        viewport {{ vpW }}×{{ vpH }} · scale {{ scale.toFixed(3) }} · 留白 横
        {{ letterbox.x.toFixed(0) }}px / 纵 {{ letterbox.y.toFixed(0) }}px<br />
        board L{{ boardRect?.l ?? "?" }} T{{ boardRect?.t ?? "?" }} R{{
          boardRect?.r ?? "?"
        }}
        B{{ boardRect?.b ?? "?" }} · chat L{{ chatRect?.l ?? "?" }} T{{
          chatRect?.t ?? "?"
        }}
        R{{ chatRect?.r ?? "?" }} B{{ chatRect?.b ?? "?" }}
      </div>
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
  /* 卡片层压过全部背景元素（SynthwaveBg z-index:0） */
  z-index: 20;
  overflow: hidden;
}
/* 固定 1920×1080 画布：绝对居中 + 等比缩放（--card-w 按列数给行内卡片宽度）。
   场景页无全局 border-box，必须显式声明——否则 1920×1080 被当作内容盒，
   加上左右 56 / 底 38 内边距后实际盒子 2032×1118，居中缩放与聊天卡的
   绝对定位参照全部错位（曾表现为 OBS 中聊天卡贴左） */
.board {
  position: absolute;
  left: 50%;
  top: 50%;
  box-sizing: border-box;
  width: 1920px;
  height: 1080px;
  /* 顶部不留 padding：池的顶部让位由脚本 poolTop 动态给（顶栏在视口层不缩放） */
  padding: 0 56px 38px;
  display: flex;
  flex-direction: column;
}
/* 顶部信息栏（视口层）：铺满视口宽、贴画面顶部、不随画布缩放——与比赛
   详情页同尺寸同位置；压在画布之上，池顶部让位见脚本 poolTop */
.view-top {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 2;
}
.pool {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px; /* 类别之间与行距一致，整体紧凑 */
  /* 无页标题，整体靠上；聊天为左下角悬浮层（半透明、不挡交互） */
  justify-content: flex-start;
}
.pool.overflowing {
  overflow-y: auto;
}
/* 整体下沉：最下行底部压到聊天盒顶沿上方（227 = 底距12 + 满高199 + 空隙16，
   换算池内下边距 227 − 画布底距38 = 189）。pinned 由脚本判定：内容装得下才贴靠 */
.pool.pinned {
  justify-content: flex-end;
  padding-bottom: 189px;
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

/* ---- 左下角聊天区（OBS 只读展示；单行样式对齐管理端日志） ---- */
.chat-box {
  position: absolute;
  /* 侧面/底部边距一致（12px）；满幅缩放下 16:9 视口的画布边即画面边，
   *  视觉边距同为 12px */
  left: 12px;
  bottom: 12px;
  width: 780px;
  /* 固定满尺寸：5 行内容 + 4 间距 + 上下内边距与边框（场景页无全局
     border-box，须显式声明否则 height 只含内容区） */
  box-sizing: border-box;
  height: calc(5 * 27px + 4 * 8px + 2 * 14px + 2 * 2px);
  padding: 14px 18px;
  border-radius: 14px;
  border: 2px solid var(--syn-border);
  /* 半透明板：背景动画隐约透出，与词条板一致 */
  background: var(--syn-panel);
  pointer-events: none;
}
/* 消息区：贴底锚定（不足 5 行也靠底，最早的消息同样自底部进入）；
   溢出在顶部按同边距截断——裁剪边界即上下 14px 内边距线，与底部对齐 */
.chat-lines {
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 8px;
  overflow: hidden;
}
/* 新消息自底部滑入：起始位移 = 自身行高 + 行距（先落在裁剪区外不可见） */
.chat-enter-active {
  transition: transform 0.35s ease-out, opacity 0.35s ease-out;
}
.chat-enter-from {
  transform: translateY(calc(100% + 8px));
  opacity: 0;
}
/* 既有行整体上移（FLIP move），与新消息滑入合成整块连续上滚 */
.chat-move {
  transition: transform 0.35s ease-out;
}
/* 滑出渲染窗口的旧行：瞬时移除（顶部裁剪区外，无可动画内容） */
.chat-leave-active {
  display: none;
}
.chat-line {
  display: flex;
  /* 顶部对齐：折行消息的时间 / 名字对齐第一行（居中会悬在多行文本中部）。
     不可用 baseline——mono 时间（16px）与正文（21px）混排时行高 = 跨字号
     最大上伸 + 最大下伸，比 27px 高约 1px，5 行累计溢出必裁顶；顶部对齐
     各行盒严格 27px（单行时与居中显示无异），高度算式才精确成立 */
  align-items: flex-start;
  font-size: 21px;
  /* 固定行高：与 .chat-box 高度算式配对 */
  line-height: 27px;
}
/* 系统行整体变暗（与管理端一致） */
.chat-line.sys .cl-name,
.chat-line.sys .cl-text {
  color: var(--syn-text-dim);
}
.cl-time {
  width: 72px;
  flex-shrink: 0;
  font-size: 16px;
  color: var(--syn-text-dim);
  font-family: "JetBrains Mono Variable", ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, monospace;
}
.cl-name {
  width: 150px;
  flex-shrink: 0;
  font-weight: 700;
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-left: 2px;
}
/* 名字按身份着色：A 蓝 / B 橙 / 裁判黄 / 其余灰（与管理端一致） */
.cl-sys {
  color: var(--syn-text-dim);
}
.cl-pa {
  color: var(--syn-a);
}
.cl-pb {
  color: var(--syn-b);
}
.cl-ref {
  color: #f0a020;
}
.cl-text {
  margin-left: 10px;
  color: var(--syn-text);
  word-break: break-word;
  white-space: pre-wrap;
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

/* ---- ?debug=1 几何自检 ---- */
/* 伪元素画边框：outline 在 transform 元素上可能整条不绘制（实测 Chrome 仅
   顶部露出 1px、OBS 完全不可见），伪元素是普通盒必定渲染 */
.board.debug-outline::before {
  content: "";
  position: absolute;
  inset: 0;
  border: 4px solid #ffef3d;
  z-index: 999;
  pointer-events: none;
}
.debug-geo {
  position: absolute;
  top: 8px;
  right: 12px;
  z-index: 40;
  font-size: 18px;
  line-height: 1.4;
  font-weight: 700;
  color: #0a0118;
  background: #ffef3d;
  padding: 6px 12px;
  border-radius: 6px;
  font-family: "JetBrains Mono Variable", ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, monospace;
  pointer-events: none;
}
</style>

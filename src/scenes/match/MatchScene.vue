<script setup lang="ts">
/**
 * 比赛详情场景页根组件（直播主界面，需求见 ignored/黄昏杯导播端比赛详情页面需求.md）。
 *
 * 布局（1920×1080）：
 *   顶部：信息栏 TopBar（选手名/比分指示器/赛事·比赛标题，需求见顶栏文档）
 *   中部：双 4:3 选手画面满宽无缝并列（16:9 推流裁左右）
 *   下部：多关偏差条（单关隐藏）→ 双方计时器（主大字 + 副小字，屏幕中轴对称）
 *   左下角：当前选图角标卡（裁判宣布选图后常驻，PickCornerCard）
 *   右下角：PB 角标卡（当前项目 WR + 双方 PB，PbCornerCard，speedrun 同源）
 *
 * 数据：onMounted 连 WS（director.connect），WS 断 / 无 match → mock 兜底（绝不黑屏）。
 * 计时 / 偏差口径见 useMatchTiming。导播配置（RTMP/HLS）走 useDirectorConfig
 * （localStorage），?edit=1 唤出面板。
 */
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useDirectorStore } from "@/stores/director";
import { CategoryKind, MatchPhase, PickType } from "@/api/types";
import { formatMs } from "@/utils/format";
import { categoryKindOf } from "@/utils/mappool";
import { setSpeedrunToken } from "@/api/speedrun";
import { useCategoryInfo } from "@/scenes/categoryinfo/useCategoryInfo";
import SynthwaveBg from "@/scenes/components/SynthwaveBg.vue";
import DirectorConfigPanel from "@/scenes/components/DirectorConfigPanel.vue";
import { useSceneContext } from "@/scenes/composables/useSceneContext";
import { useDirectorConfig } from "@/scenes/composables/useDirectorConfig";
import { MOCK_MATCH, MOCK_TOPBAR } from "@/scenes/mock/matchDetail";
import { MOCK_MAPPOOL } from "@/scenes/mock/mappool";
import { MOCK_LEADERBOARD, MOCK_SPEEDRUN_A, MOCK_SPEEDRUN_B } from "@/scenes/mock/categoryinfo";
import { useDraftStatus, retryOf } from "@/scenes/mappool/useDraftStatus";
import TopBar from "@/scenes/components/TopBar.vue";
import { useMatchTiming } from "./useMatchTiming";
import DiffBar from "./DiffBar.vue";
import PlayerTimer from "./PlayerTimer.vue";
import StreamFrame from "./StreamFrame.vue";
import PickCornerCard from "./PickCornerCard.vue";
import PbCornerCard from "./PbCornerCard.vue";

const { t } = useI18n();
const director = useDirectorStore();
const { params, hosted, sharedBg, sharedTopBar } = useSceneContext();
const { config, load, save } = useDirectorConfig();

const panelOpen = ref(params.editMode);

/** 是否已连 WS（独立入口连上即视为 live；hosted 由舞台根维持）；否则用 mock。
 *  hosted 初始即 true：舞台切场景重挂载时 store 已有实时数据，若先渲染一帧 mock，
 *  偏差条游标会以 mock 位置为过渡起点滑到真实位置（初始状态即"左→中"漂移） */
const liveReady = ref(hosted);

const isMock = computed(() => !liveReady.value);

/** 多关选图模式：开赛后以回合类型为准，无回合信息时按多关展示（偏差条常驻） */
const isMulti = computed(() => {
  if (isMock.value) return MOCK_MATCH.isMulti;
  return director.currentRound ? director.currentRound.type === PickType.MULTI : true;
});

const { sideA, sideB, diffMs } = useMatchTiming({
  isMulti: () => isMulti.value,
  levelsOf: (side) =>
    liveReady.value
      ? director.playerOf(side).completedLevels
      : side === "A"
        ? MOCK_MATCH.levelsA
        : MOCK_MATCH.levelsB,
  attemptsOf: (side) =>
    liveReady.value
      ? director.playerOf(side).attempts
      : side === "A"
        ? MOCK_MATCH.attemptsA
        : MOCK_MATCH.attemptsB,
  scoring: () => (liveReady.value ? director.scoringMethodName : MOCK_MATCH.scoringMethod),
  scoreOf: (side) => {
    if (!liveReady.value || !director.lastResult) return null;
    return side === "A" ? director.lastResult.scoreA : director.lastResult.scoreB;
  },
  roundKey: () => (liveReady.value ? director.currentRound?.roundId ?? null : null),
  running: () =>
    liveReady.value && director.phase === MatchPhase.IN_ROUND && !director.lastResult,
  liveClock: () => liveReady.value,
});

const mainA = computed(() => formatMs(sideA.value.mainMs));
const mainB = computed(() => formatMs(sideB.value.mainMs));
const subA = computed(() =>
  sideA.value.subMs == null ? null : formatMs(sideA.value.subMs),
);
const subB = computed(() =>
  sideB.value.subMs == null ? null : formatMs(sideB.value.subMs),
);

// ---- 左下角当前选图角标卡（pick_announced → currentRound.pick 常驻展示） ----
// mock 演示选图：图池 mock 的 CT 选图（带词条与重试，角标各要素齐备）
const MOCK_PICK =
  MOCK_MAPPOOL.categories.find((c) => c.name === CategoryKind.CT)?.picks[1] ??
  MOCK_MAPPOOL.categories[0]!.picks[0]!;
const MOCK_DRAFT: Record<string, unknown> = {
  picks: [
    {
      by: "A",
      code: MOCK_PICK.code,
      tags: MOCK_PICK.tag ? [MOCK_PICK.tag] : [],
      retry: MOCK_PICK.retry_count ?? undefined,
    },
  ],
};

// pick 方 / 携带词条 / 重试次数与图池场景同源：draft_state 广播 → useDraftStatus
const draftStatus = useDraftStatus(
  computed(() => (liveReady.value ? director.draft : MOCK_DRAFT)),
);
const currentPick = computed(() =>
  liveReady.value ? director.currentRound?.pick ?? null : MOCK_PICK,
);
const pickKind = computed(() => categoryKindOf(currentPick.value?.category));
const pickSide = computed(() => {
  const p = currentPick.value;
  return p ? (draftStatus.value.statusByCode.get(p.code)?.by ?? null) : null;
});
/** 词条仅 CT 选图展示（同图池卡口径 cardPickedTags） */
const pickTags = computed(() => {
  const p = currentPick.value;
  if (!p || pickKind.value !== CategoryKind.CT) return [];
  return draftStatus.value.pickedTagsByCode.get(p.code) ?? [];
});
const pickRetry = computed(() =>
  currentPick.value ? retryOf(draftStatus.value, currentPick.value) : null,
);

// ---- 右下角 PB 角标卡（speedrun.com 数据与 categoryinfo 场景同源共享） ----
// 复用 useCategoryInfo：模块级快照跨组件共享——舞台在 categoryinfo 场景拉过
// 榜单则此处重挂载零加载回显；hook 只接真实数据，mock 预览传 null 不发请求。
const { status: srStatus, rows: srRows, pbA: srPbA, pbB: srPbB } = useCategoryInfo(
  computed(() => (liveReady.value ? director.currentRound : null)),
  computed(() => (liveReady.value ? director.speedrunA : null)),
  computed(() => (liveReady.value ? director.speedrunB : null)),
);

/** mock 榜行（名称匹配选手着色，口径同 CategoryInfoScene 的 mockRows） */
const MOCK_SR_ROWS = MOCK_LEADERBOARD.map((r) => ({
  ...r,
  highlight:
    r.playerName === MOCK_SPEEDRUN_A
      ? ("A" as const)
      : r.playerName === MOCK_SPEEDRUN_B
        ? ("B" as const)
        : null,
}));
/** 世界纪录行 = 榜首（并列取 place=1；mock 取 mock 榜第一行）：成绩 + 玩家名 */
const wrRow = computed(() => {
  if (!liveReady.value) return MOCK_SR_ROWS[0] ?? null;
  if (srStatus.value !== "ok") return null;
  return srRows.value.find((r) => r.place === 1) ?? srRows.value[0] ?? null;
});
const wrSec = computed(() => wrRow.value?.timeSec ?? null);
const wrName = computed(() => wrRow.value?.playerName ?? null);
/** 选手 PB 三态透传（mock 用 mock 榜中该选手的行） */
const pbACard = computed(() =>
  liveReady.value ? srPbA.value : (MOCK_SR_ROWS.find((r) => r.highlight === "A") ?? null),
);
const pbBCard = computed(() =>
  liveReady.value ? srPbB.value : (MOCK_SR_ROWS.find((r) => r.highlight === "B") ?? null),
);
const pbCardVisible = computed(() =>
  liveReady.value
    ? wrSec.value != null || pbACard.value !== undefined || pbBCard.value !== undefined
    : true,
);
/** PB 行名称列 = 选手展示名（mock 用顶栏 mock 名） */
const pbNameA = computed(() => (liveReady.value ? director.nameA : MOCK_TOPBAR.nameA));
const pbNameB = computed(() => (liveReady.value ? director.nameB : MOCK_TOPBAR.nameB));

function onSaved(patch: Parameters<typeof save>[1]): void {
  save(params.matchId, patch);
}

// ---- 角标卡几何（左选图 / 右 PB）：分别锚定 A / B 计时器 ----
// 选图卡右缘锚 A 计时器左侧留 12px、PB 卡左缘锚 B 计时器右侧留 12px，两卡
// 顶缘锚各自计时器顶部、底缘贴画面底（高度由锚定推导）。计时器靠画面中轴
// 对齐，主计时盒宽已由 PlayerTimer 的满量程 min-width（MM:SS.mmm）钉稳，仍
// 随视口缩放改变字号（px 宽、顶部位置都变），须量测跟踪：观察 PlayerTimer
// 内 .stack（主计时文本盒）与 .timer 根盒（与类名耦合，改其结构须同步此处）。
const timersEl = ref<HTMLElement | null>(null);
/** 量测得到的角标卡宽 / 高（px；null = 未测得，该项回退 CSS 兜底值） */
const pickW = ref<number | null>(null);
const pickH = ref<number | null>(null);
const pbW = ref<number | null>(null);
const pbH = ref<number | null>(null);
let pickRo: ResizeObserver | null = null;

function measureCornerBoxes(): void {
  const timers = timersEl.value;
  if (!timers) return;
  const timerA = timers.querySelector<HTMLElement>(".timer.A");
  const stackA = timers.querySelector<HTMLElement>(".timer.A .stack");
  const timerB = timers.querySelector<HTMLElement>(".timer.B");
  const stackB = timers.querySelector<HTMLElement>(".timer.B .stack");
  if (!timerA || !stackA) return;
  // 相对 .timers（铺满画面宽）量取，免受页面级偏移影响
  const base = timers.getBoundingClientRect();
  const w = Math.round(stackA.getBoundingClientRect().left - base.left - 12);
  const h = Math.round(base.bottom - timerA.getBoundingClientRect().top);
  if (w > 0) pickW.value = w;
  if (h > 0) pickH.value = h;
  if (!timerB || !stackB) return;
  const w2 = Math.round(base.right - stackB.getBoundingClientRect().right - 12);
  const h2 = Math.round(base.bottom - timerB.getBoundingClientRect().top);
  if (w2 > 0) pbW.value = w2;
  if (h2 > 0) pbH.value = h2;
}

/** 量测锚定注入的角标卡几何（未测得项不注入，走 CSS 兜底） */
const pickStyle = computed(() => ({
  ...(pickW.value != null ? { width: `${pickW.value}px` } : {}),
  ...(pickH.value != null ? { height: `${pickH.value}px` } : {}),
}));
const pbStyle = computed(() => ({
  ...(pbW.value != null ? { width: `${pbW.value}px` } : {}),
  ...(pbH.value != null ? { height: `${pbH.value}px` } : {}),
}));

// 控制台 config_update 广播（WS）：实时并入本场景配置并落库
// （store 已先落库一份，此处合并幂等；未挂载时由 store 的落库兜底）
watch(
  () => director.remoteConfig,
  (c) => {
    if (c) save(params.matchId, c);
  },
);

onMounted(() => {
  load(params.matchId, params);
  // speedrun 数据走后端同源代理（需 JWT）；与 categoryinfo 场景同口径
  setSpeedrunToken(params.token || null);
  // hosted（合并舞台）模式下 WS 由舞台根统一连，场景只读 store（liveReady 初始即
  // true）；否则自己连
  if (!hosted && params.token && params.matchId) {
    director.connect(params.token, params.matchId);
    // auth_ok 后 director store 会拉 meta；连上即视为 live，计时随 WS 实时刷新
    liveReady.value = true;
  }

  // 角标卡锚定计时器：RO 跟踪文本盒与计时器盒尺寸变化；视口缩放在字号 clamp
  // 平台区不改变盒尺寸，补 window resize 兜底复测
  measureCornerBoxes();
  pickRo = new ResizeObserver(() => measureCornerBoxes());
  for (const el of timersEl.value?.querySelectorAll(
    ".timer.A, .timer.A .stack, .timer.B, .timer.B .stack",
  ) ?? []) {
    pickRo.observe(el);
  }
  window.addEventListener("resize", measureCornerBoxes);
});
onUnmounted(() => {
  pickRo?.disconnect();
  window.removeEventListener("resize", measureCornerBoxes);
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
      <div class="content">
        <!-- 顶部信息栏：三分区（选手A / 赛事·比赛信息 / 选手B），mock 时传演示值；
             hosted 模式下舞台常驻单实例顶栏（sharedTopBar），此处让位只留占位 -->
        <header class="top-zone">
          <TopBar v-if="!sharedTopBar" :mock="isMock ? MOCK_TOPBAR : undefined" />
        </header>

        <!-- 双 4:3 选手画面：水平居中、无缝衔接、满屏宽 -->
        <section class="streams">
          <StreamFrame side="A" :hls-url="config.hlsA" :rtmp-url="config.rtmpA" :embed-url="config.embedA" />
          <StreamFrame side="B" :hls-url="config.hlsB" :rtmp-url="config.rtmpB" :embed-url="config.embedB" />
        </section>

        <!-- 多关偏差条（单关模式降为透明占位，不参与布局收缩） -->
        <section class="diff-zone" :class="{ off: !isMulti }">
          <DiffBar :diff-ms="diffMs" :gap-ms="params.gapMs" />
        </section>

        <!-- 双方计时器：屏幕中轴对称，A 左 B 右，沉底 -->
        <section ref="timersEl" class="timers">
          <PlayerTimer side="A" :main="mainA" :sub="subA" />
          <PlayerTimer side="B" :main="mainB" :sub="subB" />
        </section>

        <!-- 左下角当前选图角标卡：宣布选图后常驻（无选图不占位）；:key 换选图
             重挂复位内部状态（右/顶缘锚定 A 计时器，见 measureCornerBoxes） -->
        <div
          v-if="currentPick"
          :key="currentPick.code"
          class="pick-corner"
          :style="pickStyle"
        >
          <PickCornerCard
            :pick="currentPick"
            :kind="pickKind"
            :side="pickSide"
            :retry="pickRetry"
            :tags="pickTags"
          />
        </div>

        <!-- 右下角 PB 角标卡：当前项目 WR（金）+ 双方 PB（选手色，快者在上）；
             数据与 categoryinfo 场景同源，全未拉到时不占位（左缘锚定 B 计时器） -->
        <div v-if="pbCardVisible" class="pb-corner" :style="pbStyle">
          <PbCornerCard
            :wr-sec="wrSec"
            :wr-name="wrName"
            :pb-a="pbACard"
            :pb-b="pbBCard"
            :name-a="pbNameA"
            :name-b="pbNameB"
          />
        </div>
      </div>

      <div v-if="isMock" class="mock-badge">{{ t("scenes.mockBadge") }}</div>

      <DirectorConfigPanel
        v-model:visible="panelOpen"
        :model="config"
        @saved="onSaved"
      />
    </template>
  </div>
</template>

<style scoped>
.scene {
  position: relative;
  height: 100%;
}
.content {
  position: relative;
  z-index: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
/* 顶部信息栏区：贴画面顶部，剩余空隙沉到下方吸收纵向误差 */
.top-zone {
  flex: 1;
  min-height: 5vh;
  display: flex;
  align-items: flex-start;
}
/* 双 4:3 画面：各占半宽无缝拼合（合计 8:3），满铺 1920px */
.streams {
  width: 100%;
  aspect-ratio: 8 / 3;
  display: grid;
  grid-template-columns: 1fr 1fr;
}
/* 偏差条：满画面宽，上缘贴紧选手画面下缘；单关模式透明占位避免布局偏移 */
.diff-zone {
  padding: 0;
  transition: opacity 0.3s ease;
}
.diff-zone.off {
  opacity: 0;
}
/* 计时器：双列以画面水平中心为锚（A 列靠右、B 列靠左），锚定画面底部 */
.timers {
  height: 14.5vh;
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 4vw;
  align-content: end;
  padding-bottom: 2.6vh;
}
/* 左下角选图角标卡：贴左缘与底缘（与偏差条同口径满贴边、无下边距），右缘
   锚定 A 计时器左侧留 12px、顶缘锚定 A 计时器顶部（脚本 measureCornerBoxes
   量测注入内联几何，宽高均为量测前兜底）；内部布局见 PickCornerCard */
.pick-corner {
  position: absolute;
  left: 0;
  bottom: 0;
  width: 20vw;
  height: 10.5vh;
  z-index: 5;
  /* 尺寸容器：PickCornerCard 内以 cqh 单位随卡高折算标题字号（满高恰好三行） */
  container-type: size;
}
/* 右下角 PB 角标卡：镜像选图卡——贴右缘与底缘，左缘锚定 B 计时器右侧留
   12px、顶缘锚定 B 计时器顶部；内部布局见 PbCornerCard */
.pb-corner {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 18vw;
  height: 10.5vh;
  z-index: 5;
  container-type: size;
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

<script setup lang="ts">
/**
 * 比赛详情场景页根组件（直播主界面，需求见 ignored/黄昏杯导播端比赛详情页面需求.md）。
 *
 * 布局（1920×1080）：
 *   顶部：信息栏 TopBar（选手名/比分指示器/赛事·比赛标题，需求见顶栏文档）
 *   中部：双 4:3 选手画面满宽无缝并列（16:9 推流裁左右）
 *   下部：多关偏差条（单关隐藏）→ 双方计时器（主大字 + 副小字，屏幕中轴对称）
 *
 * 数据：onMounted 连 WS（director.connect），WS 断 / 无 match → mock 兜底（绝不黑屏）。
 * 计时 / 偏差口径见 useMatchTiming。导播配置（RTMP/HLS）走 useDirectorConfig
 * （localStorage），?edit=1 唤出面板。
 */
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useDirectorStore } from "@/stores/director";
import { MatchPhase, PickType } from "@/api/types";
import { formatMs } from "@/utils/format";
import SynthwaveBg from "@/scenes/components/SynthwaveBg.vue";
import DirectorConfigPanel from "@/scenes/components/DirectorConfigPanel.vue";
import { useSceneContext } from "@/scenes/composables/useSceneContext";
import { useDirectorConfig } from "@/scenes/composables/useDirectorConfig";
import { MOCK_MATCH, MOCK_TOPBAR } from "@/scenes/mock/matchDetail";
import TopBar from "@/scenes/components/TopBar.vue";
import { useMatchTiming } from "./useMatchTiming";
import DiffBar from "./DiffBar.vue";
import PlayerTimer from "./PlayerTimer.vue";
import StreamFrame from "./StreamFrame.vue";

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

function onSaved(patch: Parameters<typeof save>[1]): void {
  save(params.matchId, patch);
}

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
  // hosted（合并舞台）模式下 WS 由舞台根统一连，场景只读 store（liveReady 初始即
  // true）；否则自己连
  if (!hosted && params.token && params.matchId) {
    director.connect(params.token, params.matchId);
    // auth_ok 后 director store 会拉 meta；连上即视为 live，计时随 WS 实时刷新
    liveReady.value = true;
  }
});
onUnmounted(() => {
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
          <StreamFrame side="A" :hls-url="config.hlsA" :rtmp-url="config.rtmpA" />
          <StreamFrame side="B" :hls-url="config.hlsB" :rtmp-url="config.rtmpB" />
        </section>

        <!-- 多关偏差条（单关模式降为透明占位，不参与布局收缩） -->
        <section class="diff-zone" :class="{ off: !isMulti }">
          <DiffBar :diff-ms="diffMs" :gap-ms="params.gapMs" />
        </section>

        <!-- 双方计时器：屏幕中轴对称，A 左 B 右，沉底 -->
        <section class="timers">
          <PlayerTimer side="A" :main="mainA" :sub="subA" />
          <PlayerTimer side="B" :main="mainB" :sub="subB" />
        </section>
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

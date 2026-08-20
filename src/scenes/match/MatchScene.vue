<script setup lang="ts">
/**
 * 比赛详情场景页根组件。
 *
 * 合成器浪潮背景之上：
 *   中上：赛事 logo（默认 /logo.png，?logo= 可覆盖）+ matchName
 *   顶部两侧：A(蓝,左) / B(红,右) 名字 + ScoreBlocks（BO 胜点方块）
 *   中间：TugBar 计时差进度条（双方最后共同关卡的累计用时差）
 *   下方：两个 4:3 StreamFrame（A 左 / B 右），各下接一个 PlayerInfoBox（PB + 历史）
 *
 * 数据：onMounted 连 WS（director.connect），WS 断 / 无 match → mock 兜底（绝不黑屏）。
 * 导播配置（RTMP/HLS/PB/历史）走 useDirectorConfig（localStorage），?edit=1 唤出面板。
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useDirectorStore } from "@/stores/director";
import { PlayerStatus, type LevelTime } from "@/api/types";
import SynthwaveBg from "@/scenes/components/SynthwaveBg.vue";
import DirectorConfigPanel from "@/scenes/components/DirectorConfigPanel.vue";
import { useSceneContext } from "@/scenes/composables/useSceneContext";
import { useDirectorConfig } from "@/scenes/composables/useDirectorConfig";
import { MOCK_MATCH } from "@/scenes/mock/matchDetail";
import ScoreBlocks from "./ScoreBlocks.vue";
import TugBar from "./TugBar.vue";
import StreamFrame from "./StreamFrame.vue";
import PlayerInfoBox from "./PlayerInfoBox.vue";

const { t } = useI18n();
const director = useDirectorStore();
const { params, hosted, sharedBg } = useSceneContext();
const { config, load, save } = useDirectorConfig();

const panelOpen = ref(params.editMode);

/** 品牌默认 logo（统一位置 public/logo.png，换 logo 只覆盖该文件） */
const DEFAULT_LOGO = "/logo.png";

/** 是否已收到任何 WS 真实数据（playerA 状态被更新过即算）；否则用 mock */
const liveReady = ref(false);

// 派生：WS 有数据用 director store，否则 mock
const nameA = computed(() => (liveReady.value ? director.nameOf("A") : MOCK_MATCH.nameA));
const nameB = computed(() => (liveReady.value ? director.nameOf("B") : MOCK_MATCH.nameB));
const winsA = computed(() => (liveReady.value ? director.winsA : MOCK_MATCH.winsA));
const winsB = computed(() => (liveReady.value ? director.winsB : MOCK_MATCH.winsB));
const threshold = computed(() =>
  liveReady.value && director.winThreshold ? director.winThreshold : MOCK_MATCH.winThreshold,
);
const matchName = computed(() => director.matchName || MOCK_MATCH.matchName);

const levelsA = computed<LevelTime[]>(() =>
  liveReady.value ? director.playerOf("A").completedLevels : MOCK_MATCH.levelsA,
);
const levelsB = computed<LevelTime[]>(() =>
  liveReady.value ? director.playerOf("B").completedLevels : MOCK_MATCH.levelsB,
);
const statusA = computed<PlayerStatus>(() =>
  liveReady.value ? director.playerOf("A").status : MOCK_MATCH.statusA,
);
const statusB = computed<PlayerStatus>(() =>
  liveReady.value ? director.playerOf("B").status : MOCK_MATCH.statusB,
);

const isMock = computed(() => !liveReady.value);

function onSaved(patch: Parameters<typeof save>[1]): void {
  save(params.matchId, patch);
}

onMounted(() => {
  load(params.matchId, params);
  // hosted（合并舞台）模式下 WS 由舞台根统一连，场景只读 store；否则自己连
  if (hosted) {
    liveReady.value = true;
  } else if (params.token && params.matchId) {
    director.connect(params.token, params.matchId);
    // auth_ok 后 director store 会拉 meta；连上即视为 live，比分/进度条随 WS 实时刷新
    liveReady.value = true;
  }
});
onUnmounted(() => {
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
      <div class="content">
        <!-- 顶部：两侧选手 + 中间 logo/赛事名 -->
        <header class="top">
          <div class="side-name a">
            <span class="nm">{{ nameA }}</span>
            <ScoreBlocks :wins="winsA" :threshold="threshold" side="A" />
          </div>

          <div class="center-brand">
            <img :src="params.logoUrl || DEFAULT_LOGO" class="logo" alt="logo" />
            <div class="brand-name neon-text">{{ matchName }}</div>
            <div class="bo">BO{{ liveReady && director.boFormat ? director.boFormat : MOCK_MATCH.boFormat }}</div>
          </div>

          <div class="side-name b">
            <ScoreBlocks :wins="winsB" :threshold="threshold" side="B" />
            <span class="nm">{{ nameB }}</span>
          </div>
        </header>

        <!-- 计时差进度条 -->
        <section class="tug-wrap">
          <TugBar
            :levels-a="levelsA"
            :levels-b="levelsB"
            :status-a="statusA"
            :status-b="statusB"
            :gap-ms="params.gapMs"
          />
        </section>

        <!-- 双方直播 + 信息框 -->
        <section class="players">
          <div class="player-col">
            <StreamFrame side="A" :name="nameA" :hls-url="config.hlsA" :rtmp-url="config.rtmpA" />
            <PlayerInfoBox side="A" :name="nameA" :pb="config.pbA" :history="config.histA" />
          </div>
          <div class="player-col">
            <StreamFrame side="B" :name="nameB" :hls-url="config.hlsB" :rtmp-url="config.rtmpB" />
            <PlayerInfoBox side="B" :name="nameB" :pb="config.pbB" :history="config.histB" />
          </div>
        </section>
      </div>

      <button class="scene-gear" :title="t('scenes.edit.title')" @click="panelOpen = true">⚙</button>

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
  gap: 2vh;
  padding: 2.5vh 3vw 3vh;
}
/* 顶部 */
.top {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 2vw;
}
.side-name {
  display: flex;
  align-items: center;
  gap: 14px;
}
.side-name.a {
  justify-content: flex-start;
}
.side-name.b {
  justify-content: flex-end;
}
.nm {
  font-size: clamp(20px, 2.6vw, 40px);
  font-weight: 900;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.7);
}
.side-name.a .nm {
  color: var(--syn-a);
}
.side-name.b .nm {
  color: var(--syn-b);
}
.center-brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.logo {
  width: clamp(48px, 6vw, 96px);
  height: auto;
  object-fit: contain;
}
.brand-name {
  font-size: clamp(16px, 2vw, 30px);
  font-weight: 800;
  letter-spacing: 1px;
  text-align: center;
}
.bo {
  font-size: clamp(12px, 1.1vw, 16px);
  color: var(--syn-text-dim);
  letter-spacing: 1px;
}
/* 进度条 */
.tug-wrap {
  padding: 0 4vw;
}
/* 选手区 */
.players {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 3vw;
  align-items: start;
}
.player-col {
  display: flex;
  flex-direction: column;
  gap: 1.2vh;
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

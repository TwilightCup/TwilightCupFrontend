<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useMatchStore } from "@/stores/match";
import { useDraftStore } from "@/stores/draft";
import { useAuthStore } from "@/stores/auth";
import { MatchPhase } from "@/api/types";
import MatchHeader from "@/components/MatchHeader.vue";
import CountdownBanner from "@/components/CountdownBanner.vue";
import MatchEndBanner from "@/components/MatchEndBanner.vue";
import PrepPanel from "@/components/PrepPanel.vue";
import BanPickPanel from "@/components/BanPickPanel.vue";
import VerdictPanel from "@/components/VerdictPanel.vue";
import PlayerStatusCard from "@/components/PlayerStatusCard.vue";
import CounterWidget from "@/components/CounterWidget.vue";
import ChatPanel from "@/components/ChatPanel.vue";
import RoundHistoryDrawer from "@/components/RoundHistoryDrawer.vue";
import AuthFailMask from "@/components/AuthFailMask.vue";

const match = useMatchStore();
const draft = useDraftStore();
const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const historyOpen = ref(false);

const inDraftPhase = computed(
  () => match.canMarkPrep || match.phase === MatchPhase.PREP,
);
/** 草稿/准备阶段始终展示 ban/pick 工作台（图池未载入时显示 LOAD/导入）。
 *  胜负已定（比分达阈值）时不展示：此时只待手动结束，不开新回合。 */
const showBanPick = computed(() => inDraftPhase.value && !match.winnerDecided);
/** 图池未载入（如纯裁判账号 403）时，额外保留手动 PrepPanel 降级路径。 */
const showPrepFallback = computed(
  () => inDraftPhase.value && !draft.mappool && !match.winnerDecided,
);
const showVerdict = computed(
  () =>
    match.phase === MatchPhase.IN_ROUND || match.phase === MatchPhase.ROUND_JUDGING,
);

function logout(): void {
  match.$reset();
  draft.$reset();
  auth.logout();
  router.replace("/login");
}

/** 比赛就绪后拉取结构化图池（admin-as-referee 成功；纯裁判 403 → 回退手动）。 */
watch(
  () => match.matchId,
  (sid) => {
    if (sid && auth.token && !draft.mappool && draft.mappoolSource === "") {
      void draft.loadFromMatch(sid, auth.token);
    }
  },
  { immediate: true },
);

onMounted(() => {
  if (!auth.isLoggedIn) {
    router.replace("/login");
    return;
  }
  const sid = String(route.params.matchId ?? "");
  if (!sid) {
    router.replace("/referee");
    return;
  }
  match.connect(sid);
});

onUnmounted(() => {
  match.disconnect();
});
</script>

<template>
  <div class="match-view">
    <MatchHeader
      @open-history="historyOpen = true"
      @logout="logout"
      @back="router.push('/referee')"
    />

    <div
      v-if="match.connStatus === 'reconnecting' || match.connStatus === 'connecting'"
      class="reconnect-bar"
    >
      {{ $t('conn.connectingBanner', { action: $t(match.connStatus === 'reconnecting' ? 'conn.action.reconnect' : 'conn.action.connect') }) }}
    </div>

    <main class="main">
      <div class="col-center">
        <el-alert
          v-if="!match.metaReady"
          type="info"
          :closable="false"
          show-icon
          class="cold-alert"
        >
          {{ $t('matchView.coldAlert') }}
        </el-alert>

        <CountdownBanner />

        <!-- 胜负已定：手动收尾横幅（结束比赛/踢选手由裁判触发） -->
        <MatchEndBanner v-if="match.winnerDecided && !match.matchEnded" />
        <el-alert
          v-else-if="match.matchEnded"
          type="success"
          :closable="false"
          show-icon
          class="ended-alert"
        >
          {{ $t('matchEndBanner.endedAlert') }}
        </el-alert>

        <BanPickPanel v-if="showBanPick" />
        <PrepPanel v-if="showPrepFallback" />
        <VerdictPanel v-if="showVerdict" />

        <div class="players">
          <PlayerStatusCard side="A" />
          <PlayerStatusCard side="B" />
        </div>
      </div>

      <div class="col-right">
        <CounterWidget />
        <ChatPanel />
      </div>
    </main>

    <RoundHistoryDrawer v-model="historyOpen" />

    <!-- 鉴权失败遮罩（无活动比赛时可不登出，返回主页 / 切换端） -->
    <Transition name="fade">
      <AuthFailMask
        v-if="match.authErrorMessage"
        :message="match.authErrorMessage"
      />
    </Transition>
  </div>
</template>

<style scoped>
.match-view {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.reconnect-bar {
  background: #3a2a0f;
  color: #ffe9c2;
  font-size: 12px;
  text-align: center;
  padding: 3px 0;
  border-bottom: 1px solid #5a3f12;
}
.main {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 12px;
  padding: 12px;
}
.col-center {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
}
.col-right {
  width: 360px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.col-right .chat {
  flex: 1;
  min-height: 0;
}
.cold-alert {
  margin-bottom: 12px;
}
.ended-alert {
  margin-bottom: 12px;
}
.players {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  flex: 0 0 auto;
  min-height: 200px;
}
.players > * {
  flex: 1;
}
.auth-mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.auth-card {
  width: 380px;
  max-width: calc(100vw - 32px);
  background: var(--tc-bg-soft);
  border: 1px solid var(--tc-border);
  border-radius: 12px;
  padding: 24px;
  text-align: center;
}
.ac-title {
  font-size: 18px;
  font-weight: 700;
  margin-bottom: 8px;
}
.ac-msg {
  color: #ff9a9a;
  margin: 0 0 6px;
}
.ac-hint {
  color: var(--tc-text-dim);
  font-size: 12px;
  margin: 0 0 16px;
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>

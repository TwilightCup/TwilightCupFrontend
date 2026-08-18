<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "@/stores/auth";
import { useDirectorStore } from "@/stores/director";
import RoleSwitcher from "@/components/RoleSwitcher.vue";
import AccountMenu from "@/components/AccountMenu.vue";
import AuthFailMask from "@/components/AuthFailMask.vue";
import { AttemptStatus, PlayerStatus } from "@/api/types";
import { formatMs, phaseInfo } from "@/utils/format";
import {
  getCurrentScene,
  setCurrentScene,
  type SceneKey,
} from "@/scenes/stage/useStageScene";

const { t } = useI18n();
const auth = useAuthStore();
const director = useDirectorStore();
const route = useRoute();
const router = useRouter();

const phaseLabel = computed(() => phaseInfo(director.phase).label);

function statusOf(side: "A" | "B"): { label: string; done: boolean; dead: boolean } {
  const s = director.playerOf(side).status;
  if (s === PlayerStatus.COMPLETED) return { label: t("playerStatus.completed"), done: true, dead: false };
  if (s === PlayerStatus.FORFEITED) return { label: t("playerStatus.forfeited"), done: false, dead: true };
  return { label: t("matchStatus.running"), done: false, dead: false };
}

function progText(side: "A" | "B"): string {
  if (!director.currentRound) return "—";
  const p = director.playerOf(side);
  return director.isMulti
    ? t("directorView.progLevel", { idx: p.currentLevelIndex })
    : t("directorView.progAttempt", { count: p.attempts.length });
}

function bestMs(side: "A" | "B"): number | null {
  const p = director.playerOf(side);
  if (director.isMulti) {
    const arr = p.completedLevels.map((l) => l.total_ms ?? l.time_ms);
    return arr.length ? Math.max(...arr) : null;
  }
  // 「当前最优」只看有效尝试——INVALID 的 time_ms 仅作证据，不得高亮为最优
  const arr = p.attempts
    .filter((a) => a.status === AttemptStatus.VALID)
    .map((a) => a.time_ms)
    .filter((v): v is number => v != null);
  return arr.length ? Math.min(...arr) : null;
}

async function copyUrl(url: string): Promise<void> {
  if (!url) {
    ElMessage.warning(t("directorView.overlayNotReady"));
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    ElMessage.success(t("directorView.overlayCopied"));
  } catch {
    ElMessage.warning(t("directorView.overlayCopyFail"));
  }
}

/** 直播画面链接列表（叠加层 + 三个场景页 + 合并舞台） */
const sceneLinks = computed(() => [
  { key: "overlay", label: t("directorView.sceneOverlay"), url: director.sceneUrls.overlay },
  { key: "matchDetail", label: t("directorView.sceneMatch"), url: director.sceneUrls.matchDetail },
  { key: "mappool", label: t("directorView.sceneMappool"), url: director.sceneUrls.mappool },
  { key: "bracket", label: t("directorView.sceneBracket"), url: director.sceneUrls.bracket },
]);

/** 合并舞台：单 OBS 源承载全部场景（推荐挂这一个） */
const stageUrl = computed(() => director.sceneUrls.stage);

// ---- 场景切换（写 localStorage → 合并舞台跨标签监听切换）----
const sceneBtnLabels: Record<SceneKey, string> = {
  overlay: "directorView.sceneBtnOverlay",
  match: "directorView.sceneBtnMatch",
  mappool: "directorView.sceneBtnMappool",
  bracket: "directorView.sceneBtnBracket",
};
const activeScene = ref<SceneKey>(getCurrentScene());
function onSwitchScene(key: SceneKey): void {
  activeScene.value = key;
  setCurrentScene(key);
}

function logout(): void {
  director.disconnect();
  auth.logout();
  router.replace("/login");
}

onMounted(() => {
  if (!auth.isLoggedIn) {
    router.replace("/login");
    return;
  }
  const sid = String(route.params.matchId ?? "");
  if (!sid) {
    router.replace("/director");
    return;
  }
  director.connectWithAuth(sid);
});
onUnmounted(() => {
  director.disconnect();
});
</script>

<template>
  <div class="director-view">
    <header class="top">
      <div class="brand">
        🎬 {{ $t("directorView.brand") }}
        <el-tag size="small" type="warning" effect="dark">{{ $t("directorView.readOnlyTag") }}</el-tag>
      </div>
      <div class="info">
        <el-tag :type="phaseLabel ? 'primary' : 'info'" effect="dark" size="small">
          {{ phaseLabel }}
        </el-tag>
        <span class="conn">{{ director.connStatus }}</span>
      </div>
      <RoleSwitcher />
      <el-button size="small" @click="router.push('/director')">{{ $t("directorView.myMatchesBtn") }}</el-button>
      <AccountMenu @logout="logout" />
    </header>

    <div
      v-if="['connecting', 'reconnecting'].includes(director.connStatus)"
      class="reconnect"
    >
      {{
        $t("conn.connectingBanner", {
          action: $t(director.connStatus === "reconnecting" ? "conn.action.reconnect" : "conn.action.connect"),
        })
      }}
    </div>

    <main class="main">
      <section class="col-left">
        <!-- 比分 -->
        <div class="card score-card">
          <div class="score-side a" :class="{ dim: statusOf('A').dead }">
            <div class="sname tc-a">{{ director.nameOf("A") }}</div>
            <div class="snum">{{ director.winsA }}</div>
            <div class="sstat">{{ statusOf("A").label }}</div>
          </div>
          <div class="vs">
            <span v-if="director.matchWinner" class="winner">🏆{{ director.matchWinner }}</span>
            <template v-else>:</template>
          </div>
          <div class="score-side b" :class="{ dim: statusOf('B').dead }">
            <div class="sname tc-b">{{ director.nameOf("B") }}</div>
            <div class="snum">{{ director.winsB }}</div>
            <div class="sstat">{{ statusOf("B").label }}</div>
          </div>
        </div>

        <!-- 当前回合 -->
        <div class="card">
          <div class="card-title">{{ $t("directorView.currentRoundTitle") }}</div>
          <template v-if="director.currentRound">
            <div class="round-line">
              <b>{{ director.currentRound.pick.code }}</b>
              <span class="dim">{{ director.currentRound.pick.name }}</span>
              <el-tag size="small" effect="plain">
                {{ director.isMulti ? $t("pickType.multi") : $t("pickType.single") }}
              </el-tag>
            </div>
            <div class="dim">
              {{ phaseLabel }}
              <span v-if="director.countdownRemaining != null" class="cd">
                · {{ $t("directorView.countdownLabel", { n: director.countdownRemaining }) }}
              </span>
            </div>
          </template>
          <div v-else class="dim">{{ $t("directorView.noRoundYet") }}</div>
        </div>

        <!-- 进度 -->
        <div class="card">
          <div class="card-title">{{ $t("directorView.bothProgressTitle") }}</div>
          <div class="prog-row">
            <span class="who tc-a">A · {{ director.nameOf("A") }}</span>
            <span>{{ progText("A") }}</span>
            <span class="dim">{{ $t("directorView.bestTimeLabel", { time: formatMs(bestMs("A")) }) }}</span>
          </div>
          <div class="prog-row">
            <span class="who tc-b">B · {{ director.nameOf("B") }}</span>
            <span>{{ progText("B") }}</span>
            <span class="dim">{{ $t("directorView.bestTimeLabel", { time: formatMs(bestMs("B")) }) }}</span>
          </div>
        </div>
      </section>

      <aside class="col-right">
        <!-- 场景切换（合并舞台）：写 localStorage，舞台页跨标签监听 -->
        <div class="card">
          <div class="card-title">{{ $t("directorView.sceneSwitchTitle") }}</div>
          <p class="hint">{{ $t("directorView.sceneSwitchHint") }}</p>
          <el-radio-group
            :model-value="activeScene"
            size="small"
            style="width: 100%; display: flex; flex-wrap: wrap; gap: 6px"
            @update:model-value="(v: string | number | boolean) => onSwitchScene(v as SceneKey)"
          >
            <el-radio-button
              v-for="key in (['overlay','match','mappool','bracket'] as SceneKey[])"
              :key="key"
              :value="key"
            >
              {{ $t(sceneBtnLabels[key]) }}
            </el-radio-button>
          </el-radio-group>
        </div>

        <!-- 直播画面链接（叠加层 + 场景页） -->
        <div class="card">
          <div class="card-title">{{ $t("directorView.sceneTitle") }}</div>
          <p class="hint">{{ $t("directorView.sceneHint") }}</p>
          <div class="scene-list">
            <div v-for="s in sceneLinks" :key="s.key" class="scene-row">
              <div class="scene-label">{{ s.label }}</div>
              <el-input
                :model-value="s.url || $t('directorView.sceneUnavailable')"
                readonly
                size="small"
                :disabled="!s.url"
              >
                <template #append>
                  <el-button size="small" :disabled="!s.url" @click="copyUrl(s.url)">
                    {{ $t("directorView.copyOverlayBtn") }}
                  </el-button>
                </template>
              </el-input>
            </div>
            <!-- 合并舞台：推荐挂这一个单源，导播按钮切场景 -->
            <div class="scene-row stage-row">
              <div class="scene-label">{{ $t("directorView.sceneStage") }}</div>
              <el-input
                :model-value="stageUrl || $t('directorView.sceneUnavailable')"
                readonly
                size="small"
                :disabled="!stageUrl"
              >
                <template #append>
                  <el-button size="small" :disabled="!stageUrl" @click="copyUrl(stageUrl)">
                    {{ $t("directorView.copyOverlayBtn") }}
                  </el-button>
                </template>
              </el-input>
            </div>
          </div>
        </div>

        <!-- 日志 -->
        <div class="card log-card">
          <div class="card-title">{{ $t("common.messageLog") }}</div>
          <div class="log-list">
            <div
              v-for="(m, i) in director.messages"
              :key="i"
              class="log-line"
              :class="m.kind"
            >
              <span class="t">{{ m.ts }}</span>
              <span>{{ m.text }}</span>
            </div>
          </div>
        </div>
      </aside>
    </main>

    <Transition name="fade">
      <AuthFailMask v-if="director.authError" :message="director.authError" />
    </Transition>
  </div>
</template>

<style scoped>
.director-view {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 18px;
  background: var(--tc-bg-soft);
  border-bottom: 1px solid var(--tc-border);
}
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
}
.info {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
}
.conn {
  color: var(--tc-text-dim);
  font-size: 12px;
}
.reconnect {
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
.col-left {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.col-right {
  width: 420px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}
.card {
  background: var(--tc-bg-soft);
  border: 1px solid var(--tc-border);
  border-radius: 10px;
  padding: 12px 14px;
}
.card-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--tc-text-dim);
  margin-bottom: 8px;
  letter-spacing: 0.5px;
}
.score-card {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 24px;
  padding: 18px;
}
.score-side {
  text-align: center;
  min-width: 120px;
}
.score-side.dim {
  opacity: 0.5;
}
.sname {
  font-size: 16px;
  font-weight: 700;
}
.snum {
  font-size: 48px;
  font-weight: 900;
  line-height: 1.1;
}
.score-side.a .snum {
  color: var(--tc-a);
}
.score-side.b .snum {
  color: var(--tc-b);
}
.sstat {
  font-size: 12px;
  color: var(--tc-text-dim);
}
.vs {
  font-size: 28px;
  color: var(--tc-text-dim);
}
.winner {
  color: gold;
  font-size: 18px;
  font-weight: 700;
}
.round-line {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 14px;
  margin-bottom: 4px;
}
.cd {
  color: var(--tc-primary);
}
.prog-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 0;
  font-size: 13px;
}
.prog-row .who {
  font-weight: 700;
  min-width: 120px;
}
.dim {
  color: var(--tc-text-dim);
  font-size: 12px;
}
.hint {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--tc-text-dim);
  line-height: 1.6;
}
.scene-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.scene-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.scene-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--tc-text);
}
.stage-row {
  padding-top: 8px;
  border-top: 1px dashed var(--tc-border);
  margin-top: 4px;
}
.stage-row .scene-label {
  color: var(--tc-primary);
}
.warn {
  margin: 8px 0 0;
  font-size: 12px;
  color: #ffc67a;
  line-height: 1.6;
}
.log-card {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.log-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.log-line {
  font-size: 12px;
  line-height: 1.5;
  display: flex;
  gap: 6px;
}
.log-line .t {
  color: var(--tc-text-dim);
  flex-shrink: 0;
}
.log-line.error {
  color: #ff9a9a;
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

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

/** 合并舞台：单 OBS 源承载全部场景（叠加信息 / 比赛详情 / 图池 / 赛程图） */
const stageUrl = computed(() => director.stageUrl);

// ---- 场景切换（写 localStorage → 合并舞台跨标签监听切换）----
const sceneBtnLabels: Record<SceneKey, string> = {
  overlay: "directorView.sceneBtnOverlay",
  match: "directorView.sceneBtnMatch",
  mappool: "directorView.sceneBtnMappool",
  bracket: "directorView.sceneBtnBracket",
  soon: "directorView.sceneBtnSoon",
};
const activeScene = ref<SceneKey>(getCurrentScene());
function onSwitchScene(key: SceneKey): void {
  activeScene.value = key;
  setCurrentScene(key);
}

// ---- Coming Soon 倒计时控制（localStorage → 舞台 SoonScene 跨标签同步）----
const SOON_KEY = "twc-soon-countdown";

interface SoonState {
  targetMs: number;
  startedAt: number | null;
  pausedAt: number | null;
}

const DEFAULT_TARGET_S = 300; // 5 分钟

function loadSoon(): SoonState {
  try {
    const raw = localStorage.getItem(SOON_KEY);
    if (raw) return JSON.parse(raw) as SoonState;
  } catch {
    // ignore
  }
  return { targetMs: DEFAULT_TARGET_S * 1000, startedAt: null, pausedAt: null };
}

function saveSoon(s: SoonState): void {
  try {
    localStorage.setItem(SOON_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

const soon = ref<SoonState>(loadSoon());
const soonTargetSec = computed({
  get: () => Math.round(soon.value.targetMs / 1000),
  set: (v: number) => {
    const newMs = v * 1000;
    soon.value.targetMs = newMs;
    saveSoon(soon.value);
  },
});

/** 剩余毫秒 */
const soonRemaining = computed(() => {
  const s = soon.value;
  if (s.startedAt === null) return s.targetMs;
  const base = s.pausedAt ?? Date.now();
  const elapsed = base - s.startedAt;
  return Math.max(0, s.targetMs - elapsed);
});

/** 状态文字 */
const soonStatusText = computed(() => {
  if (soon.value.startedAt === null) return t("directorView.soonIdle");
  if (soon.value.pausedAt !== null) return t("directorView.soonPaused");
  if (soonRemaining.value <= 0) return t("directorView.soonFinished");
  return t("directorView.soonRunning");
});

function soonStart(): void {
  const s = soon.value;
  if (s.pausedAt !== null) {
    // 继续：补偿暂停时长
    const pauseDuration = Date.now() - s.pausedAt;
    s.startedAt = (s.startedAt ?? 0) + pauseDuration;
    s.pausedAt = null;
  } else {
    s.startedAt = Date.now();
    s.pausedAt = null;
  }
  saveSoon(s);
}

function soonPause(): void {
  const s = soon.value;
  if (s.startedAt !== null && s.pausedAt === null) {
    s.pausedAt = Date.now();
    saveSoon(s);
  }
}

function soonReset(): void {
  soon.value = { targetMs: soon.value.targetMs, startedAt: null, pausedAt: null };
  saveSoon(soon.value);
}

// 监听舞台端可能的外部重置（跨标签）
window.addEventListener("storage", (e: StorageEvent) => {
  if (e.key === SOON_KEY && e.newValue) {
    try {
      soon.value = JSON.parse(e.newValue) as SoonState;
    } catch {
      // ignore
    }
  }
});

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
              v-for="key in (['soon','overlay','match','mappool','bracket'] as SceneKey[])"
              :key="key"
              :value="key"
            >
              {{ $t(sceneBtnLabels[key]) }}
            </el-radio-button>
          </el-radio-group>
        </div>

        <!-- Coming Soon 倒计时控制（仅待开始场景可用） -->
        <div v-if="activeScene === 'soon'" class="card">
          <div class="card-title">{{ $t("directorView.soonTitle") }}</div>
          <p class="hint">{{ $t("directorView.soonHint") }}</p>
          <div class="soon-row">
            <span class="soon-label">{{ $t("directorView.soonLabel") }}</span>
            <el-input-number
              :model-value="soonTargetSec"
              :min="10"
              :max="3600"
              :step="30"
              size="small"
              style="width: 120px"
              @change="(v: number | undefined) => { if (v != null) soonTargetSec = v; }"
            />
            <span class="soon-status" :class="{ running: soon.startedAt !== null && soon.pausedAt === null && soonRemaining > 0 }">
              {{ soonStatusText }}
            </span>
          </div>
          <div class="soon-remaining" v-if="soon.startedAt !== null">
            {{ Math.ceil(soonRemaining / 1000) }}s
          </div>
          <div class="soon-btns">
            <el-button
              size="small"
              type="primary"
              :disabled="soonRemaining <= 0 && soon.startedAt !== null"
              @click="soonStart()"
            >
              {{ soon.pausedAt !== null ? $t("directorView.soonResume") : $t("directorView.soonStart") }}
            </el-button>
            <el-button
              size="small"
              :disabled="!soon.startedAt || soon.pausedAt !== null || soonRemaining <= 0"
              @click="soonPause()"
            >
              {{ $t("directorView.soonPause") }}
            </el-button>
            <el-button
              size="small"
              @click="soonReset()"
            >
              {{ $t("directorView.soonReset") }}
            </el-button>
          </div>
        </div>

        <!-- 直播画面链接：合并舞台单源（全部场景在其中渲染 + 控制台切场景） -->
        <div class="card">
          <div class="card-title">{{ $t("directorView.sceneTitle") }}</div>
          <p class="hint">{{ $t("directorView.sceneHint") }}</p>
          <div class="scene-row">
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
.scene-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.scene-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--tc-primary);
}
.soon-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.soon-label {
  font-size: 13px;
  color: var(--tc-text);
  white-space: nowrap;
}
.soon-status {
  font-size: 12px;
  color: var(--tc-text-dim);
  margin-left: auto;
}
.soon-status.running {
  color: var(--tc-primary);
  font-weight: 600;
}
.soon-remaining {
  font-size: 28px;
  font-weight: 900;
  color: var(--tc-primary);
  text-align: center;
  padding: 6px 0;
  font-variant-numeric: tabular-nums;
}
.soon-btns {
  display: flex;
  gap: 8px;
  margin-top: 4px;
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

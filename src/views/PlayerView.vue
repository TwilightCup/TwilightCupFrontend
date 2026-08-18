<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "@/stores/auth";
import { usePlayerStore } from "@/stores/player";
import RoleSwitcher from "@/components/RoleSwitcher.vue";
import AccountMenu from "@/components/AccountMenu.vue";
import AuthFailMask from "@/components/AuthFailMask.vue";
import { MatchPhase, PlayerStatus } from "@/api/types";
import { formatMs, phaseInfo } from "@/utils/format";

const { t } = useI18n();
const auth = useAuthStore();
const player = usePlayerStore();
const router = useRouter();

const isDev = import.meta.env.DEV;

const inputSec = ref(10);
const chatInput = ref("");
const ms = (): number => Math.max(0, Math.round(inputSec.value * 1000));
const totalOfLevels = computed(() =>
  player.myLevels.reduce((n, l) => n + (l.time_ms ?? 0), 0),
);

const myReady = computed(() =>
  player.side === "A" ? player.aReady : player.bReady,
);
const inPrep = computed(() => player.phase === MatchPhase.PREP);
const inRound = computed(() => player.phase === MatchPhase.IN_ROUND);
const myStatusText = computed(() => {
  const s = player.myStatus;
  if (s === PlayerStatus.COMPLETED) return t("playerStatus.completed");
  if (s === PlayerStatus.FORFEITED) return t("playerStatus.forfeited");
  return t("playerStatus.inGame");
});

function logout(): void {
  player.disconnect();
  auth.logout();
  router.replace("/login");
}
function onReady(): void {
  player.toggleReady();
}
function sendChat(): void {
  if (!chatInput.value.trim()) return;
  player.sendChat(chatInput.value);
  chatInput.value = "";
}
function onUploadNextLevel(): void {
  const idx = player.myCurrentLevelIndex;
  player.uploadLevel(idx, ms(), totalOfLevels.value + ms());
  ElMessage.success(t("player.levelUploaded", { idx: idx + 1, sec: inputSec.value }));
}
function onCompleteMulti(): void {
  player.complete(totalOfLevels.value);
}
function onForfeitMulti(): void {
  player.forfeit("multi_exit");
}
function onUploadAttempt(): void {
  const idx = player.myAttempts.length;
  player.uploadLevel(idx, ms());
  ElMessage.success(t("player.attemptUploaded", { idx: idx + 1, sec: inputSec.value }));
}
function onSkipAttempt(): void {
  player.skipAttempt(player.myAttempts.length);
}
function onCompleteSingle(): void {
  player.complete(null);
}
function onForfeitSingle(): void {
  player.forfeit("single_exit_0_valid");
}

onMounted(() => {
  if (!isDev) return;
  if (!auth.isLoggedIn) {
    router.replace("/login");
    return;
  }
  player.connect();
});
onUnmounted(() => {
  player.disconnect();
});
</script>

<template>
  <div class="player-view">
    <template v-if="!isDev">
      <div class="dev-mask">
        <div class="dev-card">
          <div class="emoji">🚧</div>
          <h2>{{ $t("player.devMaskTitle") }}</h2>
          <p class="dim">{{ $t("player.devMaskDesc") }}</p>
          <el-button type="primary" @click="logout">{{ $t("player.backToLoginBtn") }}</el-button>
        </div>
      </div>
    </template>

    <template v-else>
      <header class="top">
        <div class="brand">
          🎮 {{ $t("brand.player") }}
          <el-tag size="small" type="warning" effect="dark">DEV</el-tag>
        </div>
        <div class="info">
          <b>{{ player.side === "A" ? $t("seat.a") : player.side === "B" ? $t("seat.b") : $t("player.noSeat") }}</b>
          <el-tag :type="phaseInfo(player.phase).type" effect="dark" size="small">
            {{ phaseInfo(player.phase).label }}
          </el-tag>
          <span class="score">{{ $t("player.scoreDisplay", { a: player.winsA, b: player.winsB }) }}</span>
          <span v-if="player.countdownRemaining != null" class="cd">
            ⏱ {{ player.countdownRemaining }}
          </span>
          <span v-if="player.matchWinner" class="winner">{{ $t("player.winnerAnnounce", { winner: player.matchWinner }) }}</span>
          <span class="conn">{{ player.connStatus }}</span>
        </div>
        <RoleSwitcher />
      <AccountMenu @logout="logout" />
      </header>

      <div
        v-if="['connecting', 'reconnecting'].includes(player.connStatus)"
        class="reconnect"
      >
        {{
          $t("conn.connectingBanner", {
            action: $t(player.connStatus === "reconnecting" ? "conn.action.reconnect" : "conn.action.connect"),
          })
        }}
      </div>

      <main class="main">
        <section class="col-left">
          <!-- 当前回合 -->
          <div class="card">
            <div class="card-title">{{ $t("player.currentRoundTitle") }}</div>
            <template v-if="player.currentRound">
              <div class="round-info">
                <b>{{ player.currentRound.pick.code }}</b>
                <span class="pname">{{ player.currentRound.pick.name }}</span>
                <el-tag size="small" effect="plain">
                  {{ player.isMulti ? $t("pickType.multi") : $t("pickType.single") }}
                </el-tag>
                <span class="dim">
                  {{ player.isMulti ? $t("player.levelCountSuffix", { count: player.levelCount }) : $t("player.retryLimit", { count: player.retryCount }) }}
                </span>
              </div>
              <div class="raw">collection.raw = {{ JSON.stringify(player.currentRound.collection.raw) }}</div>
            </template>
            <div v-else class="dim">
              {{ $t("player.noRoundYet") }}
            </div>
          </div>

          <!-- 准备 -->
          <div v-if="inPrep" class="card">
            <div class="card-title">{{ $t("player.prepPhaseTitle") }}</div>
            <div class="ready-row">
              <span>{{ $t("seat.a") }}</span>
              <el-tag :type="player.aReady ? 'success' : 'info'" effect="dark" size="small">
                {{ player.aReady ? $t("playerStatus.ready") : $t("playerStatus.notReady") }}
              </el-tag>
              <span>{{ $t("seat.b") }}</span>
              <el-tag :type="player.bReady ? 'success' : 'info'" effect="dark" size="small">
                {{ player.bReady ? $t("playerStatus.ready") : $t("playerStatus.notReady") }}
              </el-tag>
            </div>
            <el-button :type="myReady ? 'warning' : 'primary'" @click="onReady">
              {{ myReady ? $t("player.cancelReadyBtn") : $t("player.readyBtn") }}
            </el-button>
          </div>

          <!-- 回合操作 -->
          <div v-if="inRound && player.currentRound" class="card">
            <div class="card-title">
              {{ $t("player.gameOutputTitle") }}<span v-if="player.myDone" class="dim">{{ $t("player.endedSuffix") }}</span>
            </div>

            <div class="input-row">
              <span class="lab">{{ $t("player.timeInputSecLabel") }}</span>
              <el-input-number
                v-model="inputSec"
                :min="0"
                :step="1"
                :precision="1"
                size="small"
              />
            </div>

            <template v-if="player.isMulti">
              <div class="dim">
                {{ $t("player.nextLevelInfo", { idx: player.myCurrentLevelIndex + 1, total: player.levelCount }) }}
              </div>
              <div class="btn-row">
                <el-button type="primary" size="small" :disabled="player.myDone" @click="onUploadNextLevel">
                  {{ $t("player.uploadLevelBtn") }}
                </el-button>
                <el-button type="success" size="small" :disabled="player.myDone" @click="onCompleteMulti">
                  {{ $t("player.completeProjectBtn") }}
                </el-button>
                <el-button type="danger" size="small" :disabled="player.myDone" @click="onForfeitMulti">
                  {{ $t("player.forfeitMidBtn") }}
                </el-button>
              </div>
            </template>
            <template v-else>
              <div class="dim">
                {{ $t("player.nextAttemptInfo", { idx: player.myAttempts.length + 1, limit: player.retryCount }) }}
              </div>
              <div class="btn-row">
                <el-button type="primary" size="small" :disabled="player.myDone" @click="onUploadAttempt">
                  {{ $t("player.uploadAttemptBtn") }}
                </el-button>
                <el-button size="small" :disabled="player.myDone" @click="onSkipAttempt">
                  {{ $t("player.skipAttemptBtn") }}
                </el-button>
                <el-button type="success" size="small" :disabled="player.myDone" @click="onCompleteSingle">
                  {{ $t("player.completeProjectBtn") }}
                </el-button>
                <el-button type="danger" size="small" :disabled="player.myDone" @click="onForfeitSingle">
                  {{ $t("player.zeroValidForfeitBtn") }}
                </el-button>
              </div>
            </template>
          </div>

          <!-- 我的进度 -->
          <div v-if="player.currentRound" class="card">
            <div class="card-title">{{ $t("player.myProgressTitle", { status: myStatusText }) }}</div>
            <template v-if="player.isMulti">
              <div v-if="player.myLevels.length === 0" class="dim">{{ $t("player.notYetReported") }}</div>
              <div v-for="lv in player.myLevels" :key="lv.level_index" class="prog">
                {{ $t("player.levelProgLine", { idx: lv.level_index + 1, time: formatMs(lv.time_ms) }) }}
                <span class="dim">{{ $t("player.cumulativeLabel", { total: formatMs(lv.total_ms ?? null) }) }}</span>
              </div>
            </template>
            <template v-else>
              <div v-if="player.myAttempts.length === 0" class="dim">{{ $t("player.notYetReported") }}</div>
              <div v-for="a in player.myAttempts" :key="a.index" class="prog">
                {{ $t("player.attemptProgLine", { idx: a.index + 1, time: formatMs(a.time_ms ?? null) }) }}
              </div>
            </template>
          </div>
        </section>

        <aside class="col-right">
          <div class="card-title">{{ $t("common.messageLog") }}</div>
          <div class="log-list">
            <div
              v-for="(m, i) in player.messages"
              :key="i"
              class="log-line"
              :class="m.kind"
            >
              <span class="t">{{ m.ts }}</span>
              <span class="txt">{{ m.text }}</span>
            </div>
          </div>
          <div class="composer">
            <el-input
              v-model="chatInput"
              size="small"
              :placeholder="$t('player.chatPlaceholder')"
              @keyup.enter="sendChat"
            />
            <el-button size="small" type="primary" @click="sendChat">{{ $t("common.send") }}</el-button>
          </div>
        </aside>
      </main>

      <!-- 鉴权失败 -->
      <Transition name="fade">
        <AuthFailMask
          v-if="player.authErrorMessage"
          :message="player.authErrorMessage"
        />
      </Transition>
    </template>
  </div>
</template>

<style scoped>
.player-view {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.dev-mask {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(circle at 30% 20%, var(--tc-bg-soft), var(--tc-bg) 60%);
}
.dev-card {
  width: 420px;
  max-width: calc(100vw - 32px);
  padding: 32px;
  background: var(--tc-bg-soft);
  border: 1px solid var(--tc-border);
  border-radius: 14px;
  text-align: center;
}
.dev-card .emoji {
  font-size: 44px;
}
.dev-card h2 {
  margin: 12px 0 8px;
  font-size: 18px;
}
.dev-card code {
  background: var(--tc-bg);
  padding: 1px 5px;
  border-radius: 4px;
}
.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 18px;
  background: var(--tc-bg-soft);
  border-bottom: 1px solid var(--tc-border);
  flex-wrap: wrap;
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
  flex-wrap: wrap;
}
.score {
  font-weight: 700;
}
.cd {
  color: var(--tc-primary);
  font-weight: 700;
}
.winner {
  color: var(--tc-primary);
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
  overflow: auto;
}
.col-right {
  width: 380px;
  flex-shrink: 0;
  background: var(--tc-bg-soft);
  border: 1px solid var(--tc-border);
  border-radius: 10px;
  padding: 12px;
  display: flex;
  flex-direction: column;
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
.round-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.pname {
  color: var(--tc-text-dim);
}
.raw {
  margin-top: 6px;
  font-size: 12px;
  color: var(--tc-text-dim);
  word-break: break-all;
}
.ready-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  font-size: 13px;
}
.input-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.lab {
  font-size: 13px;
}
.btn-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 6px;
}
.prog {
  font-size: 13px;
  padding: 2px 0;
}
.dim {
  color: var(--tc-text-dim);
  font-size: 12px;
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
.log-line.error .txt {
  color: #ff9a9a;
}
.log-line.result .txt,
.log-line.match .txt {
  color: var(--tc-primary);
}
.composer {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--tc-border);
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

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "@/stores/auth";
import { useDirectorStore } from "@/stores/director";
import RoleSwitcher from "@/components/RoleSwitcher.vue";
import AccountMenu from "@/components/AccountMenu.vue";
import StreamFrame from "@/scenes/match/StreamFrame.vue";
import AuthFailMask from "@/components/AuthFailMask.vue";
import { AttemptStatus, PlayerStatus } from "@/api/types";
import { formatMs, phaseInfo, shortTime } from "@/utils/format";
import { DEFAULT_SCENE, type SceneKey } from "@/scenes/stage/useStageScene";
import {
  useDirectorConfig,
  type DirectorConfig,
} from "@/scenes/composables/useDirectorConfig";

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

/** 日志时间戳：后端 ISO → 本地 HH:MM:SS；本地已格式化的原样显示 */
function fmtTs(ts: string): string {
  return shortTime(ts) || ts;
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

// ---- 导播配置（HLS/嵌入）：控制台集中编辑，保存后写入舞台链接 ----
const { config: cfgConfig, load: loadCfg, save: saveCfg } = useDirectorConfig();
/** 表单本地副本：编辑中不落库，点保存才写 localStorage + 更新舞台链接 */
const cfgForm = reactive<DirectorConfig>({
  hlsA: "",
  hlsB: "",
  embedA: "",
  embedB: "",
  hideA: false,
  hideB: false,
  refreshA: 0,
  refreshB: 0,
});
const cfgFields: { key: keyof DirectorConfig; label: string }[] = [
  { key: "hlsA", label: "scenes.edit.hlsA" },
  { key: "hlsB", label: "scenes.edit.hlsB" },
  { key: "embedA", label: "scenes.edit.embedA" },
  { key: "embedB", label: "scenes.edit.embedB" },
];
// matchId 在 auth_ok 后才有；连接建立即载入该场已存配置
watch(
  () => director.matchId,
  (id) => {
    if (!id) return;
    loadCfg(id, {});
    Object.assign(cfgForm, cfgConfig);
  },
  { immediate: true },
);
function saveConfig(): void {
  if (!director.matchId) return;
  saveCfg(director.matchId, { ...cfgForm });
  // WS 广播 config_update：已打开的舞台（可能另一浏览器/机器）实时并入；
  // 后端只发给同账号其他导播连接（排除本发送方），无回环
  director.sendDirectorCommand("config_update", { config: { ...cfgForm } });
  ElMessage.success(t("directorView.cfgSaved"));
}

/** 直播画面实时控制：改动即时保存并广播（不等「保存」按钮） */
function pushConfig(patch: Partial<DirectorConfig>): void {
  if (!director.matchId) return;
  saveCfg(director.matchId, patch);
  director.sendDirectorCommand("config_update", { config: patch });
}

/** 显示开关（on = 显示画面，off = 隐藏成等待信号占位） */
const showA = computed({
  get: () => !cfgForm.hideA,
  set: (v: boolean) => {
    cfgForm.hideA = !v;
    pushConfig({ hideA: !v });
  },
});
const showB = computed({
  get: () => !cfgForm.hideB,
  set: (v: boolean) => {
    cfgForm.hideB = !v;
    pushConfig({ hideB: !v });
  },
});

/** 应急重拉流：计数自增 → 舞台该侧播放器重挂（重新取 manifest） */
function refreshStream(side: "A" | "B"): void {
  const key = side === "A" ? "refreshA" : "refreshB";
  const next = cfgForm[key] + 1;
  cfgForm[key] = next;
  pushConfig({ [key]: next } as Partial<DirectorConfig>);
}

// 其他控制台（同账号另一浏览器）保存的配置广播过来：并入本地面板与舞台链接
watch(
  () => director.remoteConfig,
  (c) => {
    if (!c || !director.matchId) return;
    saveCfg(director.matchId, c);
    Object.assign(cfgForm, c);
  },
);

/** 合并舞台：单 OBS 源承载全部场景（叠加信息 / 比赛详情 / 图池 / 赛程图）。
 *  链接附带已保存的导播配置（hls/embed 参数）——舞台可能在另一浏览器/
 *  机器（localStorage 不通），配置只能经 URL 下发；舞台加载时会采用并落本地。 */
const CFG_URL_KEYS: Partial<Record<keyof DirectorConfig, string>> = {
  hlsA: "hls_a",
  hlsB: "hls_b",
  embedA: "embed_a",
  embedB: "embed_b",
};
const stageUrl = computed(() => {
  const base = director.stageUrl;
  if (!base) return "";
  const entries = Object.entries(CFG_URL_KEYS) as [keyof DirectorConfig, string][];
  const qs = entries
    .filter(([k]) => cfgConfig[k])
    .map(([k, p]) => `${p}=${encodeURIComponent(String(cfgConfig[k]))}`)
    .join("&");
  return qs ? `${base}&${qs}` : base;
});

// ---- 场景切换（写 localStorage → 合并舞台跨标签监听切换）----
const sceneBtnLabels: Record<SceneKey, string> = {
  categoryinfo: "directorView.sceneBtnCategoryinfo",
  match: "directorView.sceneBtnMatch",
  mappool: "directorView.sceneBtnMappool",
  bracket: "directorView.sceneBtnBracket",
  soon: "directorView.sceneBtnSoon",
};
const activeScene = ref<SceneKey>(DEFAULT_SCENE);
function onSwitchScene(key: SceneKey): void {
  activeScene.value = key;
  director.sendDirectorCommand("switch_scene", { scene: key }); // WS 广播（唯一通道，按账号隔离）
}
// WS 侧场景指令（state_sync 回放 / 其他控制台切换）→ 本地 radio 跟随
watch(
  () => director.currentSceneCmd,
  (s) => {
    if (s) activeScene.value = s as SceneKey;
  },
);

// ---- Coming Soon 倒计时控制（WS 广播 → 舞台 SoonScene 跨进程同步）----

/** 读 director store 的 soonCmdState（WS 广播的权威状态） */
const soonTargetSec = computed({
  get: () => Math.round(director.soonCmdState.targetMs / 1000),
  set: (v: number) => {
    const newMs = v * 1000;
    // 同步本地 + WS 发送
    director.soonCmdState.targetMs = newMs;
    director.sendDirectorCommand("soon_set_target", { target_ms: newMs });
  },
});

/** 剩余毫秒 */
const soonRemaining = computed(() => {
  const s = director.soonCmdState;
  if (s.startedAt === null) return s.targetMs;
  const base = s.pausedAt ?? Date.now();
  const elapsed = base - s.startedAt;
  return Math.max(0, s.targetMs - elapsed);
});

/** 状态文字 */
const soonStatusText = computed(() => {
  const s = director.soonCmdState;
  if (s.startedAt === null) return t("directorView.soonIdle");
  if (s.pausedAt !== null) return t("directorView.soonPaused");
  if (soonRemaining.value <= 0) return t("directorView.soonFinished");
  return t("directorView.soonRunning");
});

function soonStart(): void {
  director.sendDirectorCommand("soon_start");
}

function soonPause(): void {
  director.sendDirectorCommand("soon_pause");
}

function soonReset(): void {
  director.sendDirectorCommand("soon_reset");
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
              v-for="key in (['soon','categoryinfo','match','mappool','bracket'] as SceneKey[])"
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
            <span class="soon-status" :class="{ running: director.soonCmdState.startedAt !== null && director.soonCmdState.pausedAt === null && soonRemaining > 0 }">
              {{ soonStatusText }}
            </span>
          </div>
          <div class="soon-remaining" v-if="director.soonCmdState.startedAt !== null">
            {{ Math.ceil(soonRemaining / 1000) }}s
          </div>
          <div class="soon-btns">
            <el-button
              size="small"
              type="primary"
              :disabled="soonRemaining <= 0 && director.soonCmdState.startedAt !== null"
              @click="soonStart()"
            >
              {{ director.soonCmdState.pausedAt !== null ? $t("directorView.soonResume") : $t("directorView.soonStart") }}
            </el-button>
            <el-button
              size="small"
              :disabled="!director.soonCmdState.startedAt || director.soonCmdState.pausedAt !== null || soonRemaining <= 0"
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

        <!-- 选手画面监控：与舞台同源同配置实时预览（不受隐藏开关影响——先验证
             画面加载正常，再开下方显示开关放上台；刷新按钮同时重拉预览与舞台） -->
        <div class="card">
          <div class="card-title">{{ $t("directorView.previewTitle") }}</div>
          <p class="hint">{{ $t("directorView.previewHint") }}</p>
          <div class="stream-preview">
            <div class="sp-col">
              <span class="sp-label tc-a">A · {{ director.nameOf("A") }}</span>
              <StreamFrame
                side="A"
                :hls-url="cfgConfig.hlsA"
                :embed-url="cfgConfig.embedA"
                :refresh-nonce="cfgConfig.refreshA"
              />
            </div>
            <div class="sp-col">
              <span class="sp-label tc-b">B · {{ director.nameOf("B") }}</span>
              <StreamFrame
                side="B"
                :hls-url="cfgConfig.hlsB"
                :embed-url="cfgConfig.embedB"
                :refresh-nonce="cfgConfig.refreshB"
              />
            </div>
          </div>
        </div>

        <!-- 导播配置：HLS/嵌入，保存后写入舞台链接（跨浏览器随链接下发） -->
        <div class="card">
          <div class="card-title">{{ $t("directorView.cfgTitle") }}</div>
          <p class="hint">{{ $t("directorView.cfgHint") }}</p>
          <div class="cfg-grid">
            <label v-for="f in cfgFields" :key="f.key" class="cfg-field">
              <span class="lbl">{{ $t(f.label) }}</span>
              <el-input
                v-model="cfgForm[f.key]"
                size="small"
                :placeholder="f.key.startsWith('hls') ? 'https://.../a.m3u8' : 'https://player.bilibili.com/... 或 youtube.com/embed/...'"
              />
            </label>
          </div>
          <!-- 直播画面实时控制：显示开关 + 应急重拉流（独立管 A/B，即时广播到舞台） -->
          <div class="cfg-ctl">
            <div class="ctl-side">
              <span class="lbl tc-a">A · {{ director.nameOf("A") }}</span>
              <el-switch v-model="showA" size="small" />
              <el-button size="small" :disabled="!director.matchId" @click="refreshStream('A')">
                {{ $t("directorView.cfgRefresh") }}
              </el-button>
            </div>
            <div class="ctl-side">
              <span class="lbl tc-b">B · {{ director.nameOf("B") }}</span>
              <el-switch v-model="showB" size="small" />
              <el-button size="small" :disabled="!director.matchId" @click="refreshStream('B')">
                {{ $t("directorView.cfgRefresh") }}
              </el-button>
            </div>
          </div>
          <div class="cfg-foot">
            <el-button
              size="small"
              type="primary"
              :disabled="!director.matchId"
              @click="saveConfig()"
            >
              {{ $t("common.save") }}
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
              <span class="t">{{ fmtTs(m.ts) }}</span>
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
/* 左栏细（比分/回合/进度），右栏粗（操控/配置/日志占主视觉） */
.col-left {
  width: 380px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.col-right {
  flex: 1;
  min-width: 0;
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
.cfg-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 12px;
}
.cfg-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.cfg-field .lbl {
  font-size: 11px;
  color: var(--tc-text-dim);
}
.cfg-ctl {
  display: flex;
  gap: 12px;
  margin-top: 10px;
}
.ctl-side {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.ctl-side .lbl {
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ctl-side .el-button {
  margin-left: auto;
}
.cfg-foot {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}
/* 选手画面监控：复用舞台 StreamFrame——场景主题变量在此局部定义
   （主应用不加载 scene-theme.css，占位描边/警示色需要这几个令牌） */
.stream-preview {
  --syn-a: #3d8bff;
  --syn-b: #ff6b4a;
  --syn-magenta: #ff2e88;
  --syn-text-dim: #a99bd6;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.sp-col {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.sp-label {
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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

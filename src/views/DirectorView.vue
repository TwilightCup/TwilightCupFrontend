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
import { AttemptStatus, MatchPhase } from "@/api/types";
import { formatMs, phaseInfo, playerStatusInfo, preloadTagInfo, shortTime } from "@/utils/format";
import { DEFAULT_SCENE, isSceneKey, type SceneKey } from "@/scenes/stage/useStageScene";
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

/** 选手状态标签（离线优先，口径同裁判端 PlayerStatusCard）：离线时状态标签让位为「未连接」 */
function sideStatusInfo(side: "A" | "B"): ReturnType<typeof playerStatusInfo> {
  const online = side === "A" ? director.aOnline : director.bOnline;
  if (!online) return { label: t("playerStatus.offline"), type: "info" };
  return playerStatusInfo(director.playerOf(side).status);
}

function sideOnline(side: "A" | "B"): boolean {
  return side === "A" ? director.aOnline : director.bOnline;
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
const stageUrl = computed(() => withCfgParams(director.stageUrl));

/** 场景页链接通用后缀：附当前导播配置（hls/embed），跨浏览器随链接下发 */
function withCfgParams(base: string): string {
  if (!base) return "";
  const entries = Object.entries(CFG_URL_KEYS) as [keyof DirectorConfig, string][];
  const qs = entries
    .filter(([k]) => cfgConfig[k])
    .map(([k, p]) => `${p}=${encodeURIComponent(String(cfgConfig[k]))}`)
    .join("&");
  return qs ? `${base}&${qs}` : base;
}

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

// ---- 场景预览（左栏日志上方）：自动跟随播报流程，也可下拉临时手动指定 ----
// 自动切换随时开启：默认预览场景跟随舞台当前场景的下一个
// （图池→项目信息→比赛详情→图池 循环；其它场景（待开始/赛程图）兜底为图池）。
// 下拉仅临时手动指定预览某场景（不改舞台广播——广播场景仍由顶部 radio 切换）；
// 一旦切换广播场景即重置手动指定、回到自动跟随。下拉可预览的场景均有独立入口页。
const PREVIEW_NEXT: Partial<Record<SceneKey, SceneKey>> = {
  mappool: "categoryinfo",
  categoryinfo: "match",
};
/** 各预览场景对应的独立入口页（页面名，不带斜杠；standalone 模式自连 WS） */
const PREVIEW_PAGES: Partial<Record<SceneKey, string>> = {
  mappool: "mappool.html",
  categoryinfo: "categoryinfo.html",
  match: "match-scene.html",
  bracket: "bracket.html",
};
/** 可在下拉中手动预览的场景（均有独立入口页；soon 仅存活于合并舞台，无单页预览） */
const MANUAL_PREVIEW_SCENES: SceneKey[] = ["mappool", "categoryinfo", "match", "bracket"];
/** 自动预览场景：跟随舞台当前场景推演下一个 */
const autoPreviewScene = computed<SceneKey>(
  () => PREVIEW_NEXT[activeScene.value] ?? "mappool",
);
/** 手动指定预览场景；null = 跟随自动（默认） */
const previewManual = ref<SceneKey | null>(null);
const previewScene = computed<SceneKey>(() => previewManual.value ?? autoPreviewScene.value);
/**
 * 各可预览场景的独立入口页链接：每个场景一个常驻 iframe，全部加载后仅切显隐（v-show），
 * 场景保持连接与数据，切场景不重载（与 OBS 舞台观感一致）。配置经同源 localStorage +
 * WS config_update 实时并入场景，不经 URL 重载，故此处不放配置参数，URL 只随
 * token / 比赛 / 赛事变化（换场才重载）。
 */
const previewUrlMap = computed<Partial<Record<SceneKey, string>>>(() => {
  const map: Partial<Record<SceneKey, string>> = {};
  for (const k of MANUAL_PREVIEW_SCENES) {
    map[k] = director.scenePageUrl(PREVIEW_PAGES[k] ?? "mappool.html");
  }
  return map;
});
// 自动切换随时开启：一旦切换广播场景（顶部 radio / WS 远端）即重置手动预览，回到自动跟随
watch(activeScene, () => {
  previewManual.value = null;
});
function onPickPreviewScene(v: unknown): void {
  if (typeof v === "string" && isSceneKey(v) && MANUAL_PREVIEW_SCENES.includes(v)) {
    previewManual.value = v;
  }
}

// iframe 固定按 1920×1080 渲染再整体缩放到面板宽（与 OBS 浏览器源同口径，
// 场景内 vw/clamp 版式不随面板尺寸变形）
const previewWrapEl = ref<HTMLDivElement | null>(null);
const previewScale = ref(0.18);
let previewRo: ResizeObserver | null = null;
onMounted(() => {
  previewRo = new ResizeObserver((entries) => {
    const w = entries[0]?.contentRect.width ?? 0;
    if (w > 0) previewScale.value = w / 1920;
  });
  if (previewWrapEl.value) previewRo.observe(previewWrapEl.value);
});
onUnmounted(() => previewRo?.disconnect());

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
      <div class="top-side left">
        <div class="brand">
          🎬 {{ $t("directorView.brand") }}
          <el-tag size="small" type="warning" effect="dark">{{ $t("directorView.readOnlyTag") }}</el-tag>
        </div>
      </div>

      <!-- 场景切换（合并舞台）：居中，写 localStorage，舞台页跨标签监听 -->
      <el-radio-group
        :model-value="activeScene"
        size="small"
        class="scene-switch"
        @update:model-value="(v: string | number | boolean) => onSwitchScene(v as SceneKey)"
      >
        <el-radio-button
          v-for="key in (['soon','mappool','categoryinfo','match','bracket'] as SceneKey[])"
          :key="key"
          :value="key"
        >
          {{ $t(sceneBtnLabels[key]) }}
        </el-radio-button>
      </el-radio-group>

      <div class="top-side right">
        <div class="info">
          <el-tag :type="phaseLabel ? 'primary' : 'info'" effect="dark" size="small">
            {{ phaseLabel }}
          </el-tag>
          <span class="conn">{{ director.connStatus }}</span>
        </div>

        <!-- 导播配置下拉：HLS/嵌入链接填写 + 保存（WS 实时推送到已打开的舞台，并写入舞台链接） -->
        <el-dropdown trigger="click" placement="bottom-end">
          <el-button size="small">{{ $t("directorView.cfgTitle") }}</el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <div class="cfg-dd">
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
                <!-- 直播画面链接：合并舞台单源（全部场景在其中渲染 + 控制台切场景），链接随保存的配置下发 -->
                <div class="card-title stage-title">{{ $t("directorView.sceneTitle") }}</div>
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
            </el-dropdown-menu>
          </template>
        </el-dropdown>

        <el-button size="small" @click="router.push('/director')">{{ $t("directorView.myMatchesBtn") }}</el-button>
        <RoleSwitcher />
        <AccountMenu @logout="logout" />
      </div>
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
        <!-- 场景预览：自动切换随时开启，默认跟随播报流程预览下一个场景（图池→项目信息→
             比赛详情→图池循环，其它场景兜底图池）；右上角下拉可临时手动指定预览某场景
             （仅影响预览 iframe，不改舞台广播；切换广播场景即回到自动跟随）。
             每个可预览场景一个常驻 iframe（同源同参加载，1920×1080 缩放），
             切换仅显隐不等重载 —— 与 OBS 舞台多源无缝切台观感一致 -->
        <div class="card">
          <div class="card-title preview-head">
            <span>{{ $t("directorView.scenePreviewTitle") }}</span>
            <el-select
              :model-value="previewScene"
              size="small"
              class="preview-select"
              @update:model-value="(v: string | number | boolean | undefined) => onPickPreviewScene(v)"
            >
              <el-option
                v-for="key in MANUAL_PREVIEW_SCENES"
                :key="key"
                :value="key"
                :label="$t(sceneBtnLabels[key])"
              />
            </el-select>
          </div>
          <div ref="previewWrapEl" class="scene-preview">
            <!-- 每个可预览场景一个常驻 iframe：全部加载后仅 v-show 切换显隐，
                 场景保持连接与数据，切换预览场景不重载（与 OBS 舞台观感一致） -->
            <template v-for="key in MANUAL_PREVIEW_SCENES" :key="key">
              <iframe
                :src="previewUrlMap[key] || undefined"
                v-show="previewScene === key"
                class="preview-frame"
                :style="{ transform: `scale(${previewScale})` }"
                allow="autoplay; fullscreen"
              ></iframe>
            </template>
            <div v-if="!previewUrlMap[previewScene]" class="preview-empty">
              {{ $t("directorView.sceneUnavailable") }}
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
              <span class="t">{{ fmtTs(m.ts) }}</span>
              <span>{{ m.text }}</span>
            </div>
          </div>
        </div>
      </section>

      <aside class="col-right">
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
             画面加载正常，再开上方显示开关放上台；刷新按钮同时重拉预览与舞台） -->
        <div class="card">
          <div class="card-title">{{ $t("directorView.previewTitle") }}</div>
          <p class="hint">{{ $t("directorView.previewHint") }}</p>
          <!-- 直播画面实时控制：显示开关 + 应急重拉流（独立管 A/B，即时广播到舞台，与下方预览列对齐） -->
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
          <div class="stream-preview">
            <div class="sp-col">
              <!-- 隐藏态仅作视觉提示（画面本身仍实时播放供监控），舞台已切等待占位 -->
              <div class="sp-frame">
                <StreamFrame
                  side="A"
                  :hls-url="cfgConfig.hlsA"
                  :embed-url="cfgConfig.embedA"
                  :refresh-nonce="cfgConfig.refreshA"
                />
                <Transition name="fade">
                  <div v-if="!showA" class="hide-mask">
                    <el-icon :size="56"><Hide /></el-icon>
                  </div>
                </Transition>
              </div>
            </div>
            <div class="sp-col">
              <div class="sp-frame">
                <StreamFrame
                  side="B"
                  :hls-url="cfgConfig.hlsB"
                  :embed-url="cfgConfig.embedB"
                  :refresh-nonce="cfgConfig.refreshB"
                />
                <Transition name="fade">
                  <div v-if="!showB" class="hide-mask">
                    <el-icon :size="56"><Hide /></el-icon>
                  </div>
                </Transition>
              </div>
            </div>
          </div>
          <!-- 比分：监控下方一行居中（原左栏比分卡已并入此处）；状态标签
               （状态/就绪/预载）置于选手名与在线圆点的外侧 -->
          <div class="preview-score">
            <span class="tags">
              <!-- 与 B 侧镜像：状态标签最靠近名字/比分，整行左右对称 -->
              <el-tag :type="preloadTagInfo(director.aPreload).type" size="small" effect="plain">
                {{ $t(preloadTagInfo(director.aPreload).key) }}
              </el-tag>
              <el-tag
                v-if="director.phase === MatchPhase.PREP"
                :type="director.aReady ? ('success' as const) : ('info' as const)"
                size="small"
                effect="dark"
              >
                {{ director.aReady ? $t("playerStatus.ready") : $t("playerStatus.notReady") }}
              </el-tag>
              <el-tag :type="sideStatusInfo('A').type" size="small" effect="dark">
                {{ sideStatusInfo("A").label }}
              </el-tag>
            </span>
            <span class="name tc-a">
              <span
                class="presence"
                :class="{ off: !sideOnline('A') }"
                :title="sideOnline('A') ? '' : $t('playerStatus.offline')"
              ></span>
              {{ director.nameOf("A") }}
            </span>
            <span class="num">{{ director.winsA }}</span>
            <span class="sep">:</span>
            <span class="num">{{ director.winsB }}</span>
            <span class="name tc-b">
              {{ director.nameOf("B") }}
              <span
                class="presence"
                :class="{ off: !sideOnline('B') }"
                :title="sideOnline('B') ? '' : $t('playerStatus.offline')"
              ></span>
            </span>
            <span class="tags">
              <el-tag :type="sideStatusInfo('B').type" size="small" effect="dark">
                {{ sideStatusInfo("B").label }}
              </el-tag>
              <el-tag
                v-if="director.phase === MatchPhase.PREP"
                :type="director.bReady ? ('success' as const) : ('info' as const)"
                size="small"
                effect="dark"
              >
                {{ director.bReady ? $t("playerStatus.ready") : $t("playerStatus.notReady") }}
              </el-tag>
              <el-tag :type="preloadTagInfo(director.bPreload).type" size="small" effect="plain">
                {{ $t(preloadTagInfo(director.bPreload).key) }}
              </el-tag>
            </span>
          </div>
        </div>

        <!-- 当前回合 + 进度：左右并列 -->
        <div class="card-row">
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
  gap: 12px;
  padding: 10px 18px;
  background: var(--tc-bg-soft);
  border-bottom: 1px solid var(--tc-border);
}
/* 左右两侧等分（flex:1）夹住居中的场景切换，实现真居中 */
.top-side {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.top-side.right {
  justify-content: flex-end;
}
.scene-switch {
  display: flex;
  gap: 6px;
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
/* 左栏细（场景预览 + 日志占满），右栏粗（画面监控/回合/进度占主视觉） */
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
/* 并列卡片行（当前回合 / 双方进度）：两卡等分 */
.card-row {
  display: flex;
  gap: 12px;
}
.card-row .card {
  flex: 1;
  min-width: 0;
}
.card-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--tc-text-dim);
  margin-bottom: 8px;
  letter-spacing: 0.5px;
}
/* 场景预览卡标题行：标题居左，场景下拉居右对齐基线 */
.preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.preview-select {
  width: 168px;
}
.preview-select :deep(.el-select__wrapper) {
  padding: 1px 8px;
  min-height: 24px;
  font-weight: 500;
  letter-spacing: 0;
}
.preview-select :deep(.el-select__selected-item) {
  font-size: 12px;
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
/* 下拉内的「直播画面链接」小节标题：与上方保存按钮拉开间距 */
.stage-title {
  margin-top: 12px;
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
.cfg-dd {
  /* 下拉面板（teleport 到 body，slot 内容仍带 scoped 属性可命中样式） */
  width: 480px;
  padding: 10px 12px;
  box-sizing: border-box;
}
.cfg-ctl {
  display: flex;
  gap: 12px;
  margin-bottom: 10px;
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
  min-width: 0;
}
/* 监控下方比分行：名字按侧着色（带在线指示点），数字居中；
   状态标签内联紧贴名字同一行，过窄时整行换行兜底 */
.preview-score {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}
.preview-score .name {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 15px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
}
/* 在线状态指示点（口径同裁判端 PlayerStatusCard） */
.presence {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #37d27a;
  flex-shrink: 0;
}
.presence.off {
  background: #7a7f8a;
}
.preview-score .num {
  font-size: 20px;
  font-weight: 900;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.preview-score .sep {
  font-size: 16px;
  font-weight: 700;
  color: var(--tc-text-dim);
}
/* 状态标签组：紧随选手名之后内联排布 */
.preview-score .tags {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
/* 预览画面容器：承载隐藏态遮罩（画面继续播放，仅提示舞台侧已隐藏） */
.sp-frame {
  position: relative;
}
.hide-mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.55);
  pointer-events: none;
}
.warn {
  margin: 8px 0 0;
  font-size: 12px;
  color: #ffc67a;
  line-height: 1.6;
}
/* 场景预览：16:9 容器裁切 1920×1080 缩放帧（与 OBS 浏览器源同口径） */
.scene-preview {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-radius: 6px;
  background: #050010;
}
.preview-frame {
  position: absolute;
  top: 0;
  left: 0;
  width: 1920px;
  height: 1080px;
  border: 0;
  transform-origin: 0 0;
  /* 预览只读：不响应鼠标，防误触场景内交互 */
  pointer-events: none;
}
.preview-empty {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--tc-text-dim);
  font-size: 12px;
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

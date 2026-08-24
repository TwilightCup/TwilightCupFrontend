<script setup lang="ts">
/**
 * 项目信息场景（原「叠加信息」透明叠加层的完全重做；舞台 scene key
 * categoryinfo，独立入口 categoryinfo.html）。
 *
 * 裁判宣布选图（pick_announced → director.currentRound.pick）后，按选图
 * 的 speedrun.com 映射（speedrun_category_id / level / variables，管理端
 * 图池编辑器配置）拉取该项目排行榜 Top 15 展示；本场两位选手（账号的
 * speedrun 绑定）上榜时以选手色高亮。未映射 / 拉取失败显示状态卡。
 *
 * 双模式契约：hosted（合并舞台）时 WS 由舞台根连接，本场景只读 director
 * store；standalone 独立入口自己 connect。无 token 的独立预览显示 mock
 * 榜单（含 mock 角标），便于 OBS 调机。画面文案经 bi() 双语。
 */
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useDirectorStore } from "@/stores/director";
import { useSceneContext } from "@/scenes/composables/useSceneContext";
import SynthwaveBg from "@/scenes/components/SynthwaveBg.vue";
import TopBar from "@/scenes/components/TopBar.vue";
import { bi, biPair } from "@/utils/bilingual";
import type { Pick } from "@/api/types";
import { setSpeedrunToken } from "@/api/speedrun";
import { MOCK_TOPBAR } from "@/scenes/mock/matchDetail";
import {
  MOCK_CATEGORY_PICK,
  MOCK_LEADERBOARD,
  MOCK_SPEEDRUN_A,
  MOCK_SPEEDRUN_B,
} from "@/scenes/mock/categoryinfo";
import { useCategoryInfo, type CategoryRow } from "./useCategoryInfo";
import LeaderboardTable from "./LeaderboardTable.vue";

const { t } = useI18n();
const { params, hosted, sharedBg, sharedTopBar } = useSceneContext();
const director = useDirectorStore();

/** mock 模式：无 token 的独立预览（OBS 调机） */
const isMock = computed(() => !params.token);

const mockPick: Pick = MOCK_CATEGORY_PICK;
const mockRows: CategoryRow[] = MOCK_LEADERBOARD.map((r) => ({
  ...r,
  highlight:
    r.playerName === MOCK_SPEEDRUN_A ? "A" : r.playerName === MOCK_SPEEDRUN_B ? "B" : null,
}));

/** 当前选图（展示用；mock 模式用固定示例） */
const pickRef = computed<Pick | null>(() =>
  isMock.value ? mockPick : (director.currentRound?.pick ?? null),
);

// hook 只接真实数据：mock 模式传 null（不打真实 API，OBS 离线可调机）。
// 传整个回合而非 pick：自动解析需要消息级 collection（关卡已展开为名字；
// pick.collection 本体仍是关卡库 UUID）。
const { status, rows, refreshedAt, errDetail } = useCategoryInfo(
  computed(() => (isMock.value ? null : director.currentRound)),
  computed(() => (isMock.value ? null : director.speedrunA)),
  computed(() => (isMock.value ? null : director.speedrunB)),
);

/** mock 模式直接用静态榜（不打真实 API，OBS 离线可调机） */
const displayRows = computed<CategoryRow[]>(() =>
  isMock.value ? mockRows : rows.value,
);
const displayStatus = computed(() => (isMock.value ? "ok" : status.value));

// ── 头部信息 ─────────────────────────────────────────
const KIND_KEYS: Record<string, string> = {
  ML: "categoryKind.ml",
  IL: "categoryKind.il",
  CP: "categoryKind.cp",
  CT: "categoryKind.ct",
  EX: "categoryKind.ex",
  TB: "categoryKind.tb",
};

/** 类别标签（双语；未知 kind 原样） */
function kindLabel(kind: string | null | undefined): string {
  if (!kind) return "";
  const key = KIND_KEYS[kind.trim().toUpperCase()];
  if (!key) return kind;
  const pair = biPair(key);
  return pair.zh === key ? kind : bi(key);
}

/** 词条标签（双语；无译文的词条原样） */
function tagLabel(tag: string): string {
  const key = `ctTag.${tag}`;
  const pair = biPair(key);
  return pair.zh === key ? tag : bi(key);
}

const pickTags = computed<string[]>(() => pickRef.value?.tags ?? []);

const refreshedLabel = computed(() => {
  if (!refreshedAt.value) return "";
  const d = new Date(refreshedAt.value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
});

const headerTitle = bi("scenes.categoryinfo.title");
const sourceNote = bi("scenes.categoryinfo.sourceNote");
const highlightLegend = bi("scenes.categoryinfo.highlightLegend");

// ── 16:9 画布等比缩放（视口 ResizeObserver；老环境兜底 window resize） ──
const BOARD_W = 1920;
const BOARD_H = 1080;
const wrapEl = ref<HTMLElement | null>(null);
const scale = ref(0);
let ro: ResizeObserver | null = null;
let onWinResize: (() => void) | null = null;

function updateScale(w: number, h: number): void {
  scale.value = Math.min(w / BOARD_W, h / BOARD_H);
}

onMounted(() => {
  // speedrun 数据走后端同源代理（需 JWT）；mock 预览不发请求
  setSpeedrunToken(params.token || null);
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
      onWinResize = () =>
        updateScale(globalThis.innerWidth, globalThis.innerHeight);
      onWinResize();
      window.addEventListener("resize", onWinResize);
    }
  }
});
onUnmounted(() => {
  ro?.disconnect();
  if (onWinResize) window.removeEventListener("resize", onWinResize);
  if (!hosted) director.disconnect();
});
</script>

<template>
  <div class="scene">
    <SynthwaveBg v-if="!sharedBg" />

    <!-- 独立预览（无 token）：mock 榜单 + 角标，OBS 调机用 -->
    <template v-if="isMock">
      <div class="viewport" ref="wrapEl">
        <div class="board" :style="{ transform: `translate(-50%, -50%) scale(${scale})` }">
          <TopBar :mock="MOCK_TOPBAR" />
          <div class="content">
            <header class="head">
              <div class="head-left">
                <div class="pick-line">
                  <span class="pick-code neon-text">{{ mockPick.code }}</span>
                  <span class="pick-name">{{ mockPick.name }}</span>
                </div>
                <div class="badges">
                  <span v-if="kindLabel(mockPick.category)" class="badge">{{ kindLabel(mockPick.category) }}</span>
                  <span v-for="tg in pickTags" :key="tg" class="badge">{{ tagLabel(tg) }}</span>
                </div>
              </div>
              <div class="head-right">
                <div class="source">{{ sourceNote }}</div>
                <div class="legend">{{ highlightLegend }}</div>
              </div>
            </header>
            <div class="board-title">
              <span class="neon-text-magenta">{{ headerTitle }}</span>
              <span class="board-sub">speedrun.com</span>
            </div>
            <LeaderboardTable :rows="mockRows" />
          </div>
        </div>
      </div>
      <div class="mock-badge">{{ t("scenes.mockBadge") }}</div>
    </template>

    <template v-else>
      <div class="viewport" ref="wrapEl">
        <div class="board" :style="{ transform: `translate(-50%, -50%) scale(${scale})` }">
          <TopBar v-if="!sharedTopBar" />
          <div class="content">
            <header class="head">
              <div class="head-left">
                <div class="pick-line">
                  <span class="pick-code neon-text">{{ pickRef?.code }}</span>
                  <span class="pick-name">{{ pickRef?.name }}</span>
                </div>
                <div class="badges">
                  <span v-if="kindLabel(pickRef?.category)" class="badge">{{ kindLabel(pickRef?.category) }}</span>
                  <span v-for="tg in pickTags" :key="tg" class="badge">{{ tagLabel(tg) }}</span>
                  <span v-if="pickRef?.retry_count" class="badge">x{{ pickRef.retry_count }}</span>
                </div>
              </div>
              <div class="head-right">
                <div class="source">{{ sourceNote }}</div>
                <div v-if="refreshedLabel" class="source">
                  {{ bi("scenes.categoryinfo.refreshedAt", { time: refreshedLabel }) }}
                </div>
                <div class="legend">{{ highlightLegend }}</div>
              </div>
            </header>

            <div class="board-title">
              <span class="neon-text-magenta">{{ headerTitle }}</span>
              <span class="board-sub">speedrun.com</span>
            </div>

            <!-- 状态卡：等待选图 / 未映射 / 加载 / 失败 / 空榜 -->
            <div v-if="displayStatus !== 'ok'" class="state-card neon-panel">
              <template v-if="displayStatus === 'idle'">
                <div class="state-title neon-text">{{ bi("scenes.categoryinfo.noPickTitle") }}</div>
                <div class="state-body">{{ bi("scenes.categoryinfo.noPickBody") }}</div>
              </template>
              <template v-else-if="displayStatus === 'noMapping'">
                <div class="state-title neon-text">{{ bi("scenes.categoryinfo.noMappingTitle") }}</div>
                <div class="state-body">{{ bi("scenes.categoryinfo.noMappingBody") }}</div>
              </template>
              <template v-else-if="displayStatus === 'loading'">
                <div class="state-title neon-text">{{ bi("scenes.categoryinfo.loading") }}</div>
              </template>
              <template v-else-if="displayStatus === 'rateLimit'">
                <div class="state-title neon-text">{{ bi("scenes.categoryinfo.errorRateLimit") }}</div>
                <div v-if="errDetail" class="state-detail">{{ errDetail }}</div>
              </template>
              <template v-else-if="displayStatus === 'error'">
                <div class="state-title neon-text">{{ bi("scenes.categoryinfo.error") }}</div>
                <div v-if="errDetail" class="state-detail">{{ errDetail }}</div>
              </template>
            </div>
            <div v-else-if="displayRows.length === 0" class="state-card neon-panel">
              <div class="state-title neon-text">{{ bi("scenes.categoryinfo.empty") }}</div>
            </div>
            <LeaderboardTable v-else :rows="displayRows" />
          </div>
        </div>
      </div>

      <!-- WS 断连提示（角标；hosted 模式由舞台连接，一般常绿） -->
      <div v-if="director.connStatus !== 'open'" class="conn-badge">
        {{ bi("scenes.categoryinfo.offlineBadge") }}
      </div>
    </template>
  </div>
</template>

<style scoped>
.scene {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.viewport {
  position: absolute;
  inset: 0;
}
.board {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 1920px;
  height: 1080px;
  transform-origin: center;
}
.content {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  padding: 148px 96px 56px;
}

/* 头部：选图编号 + 名称 + 徽标（左），数据源注（右） */
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 18px;
}
.pick-line {
  display: flex;
  align-items: baseline;
  gap: 22px;
}
.pick-code {
  font-size: 64px;
  font-weight: 900;
  letter-spacing: 4px;
  color: var(--syn-win);
  text-shadow: 0 0 12px rgba(255, 209, 102, 0.55);
}
.pick-name {
  font-size: 44px;
  font-weight: 700;
  color: var(--syn-text);
}
.badges {
  display: flex;
  gap: 12px;
  margin-top: 10px;
}
.badge {
  padding: 4px 16px;
  border-radius: 999px;
  font-size: 21px;
  font-weight: 600;
  color: var(--syn-cyan);
  background: rgba(34, 227, 255, 0.08);
  border: 1px solid var(--syn-border-bright);
}
.head-right {
  text-align: right;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 8px;
}
.source {
  font-size: 19px;
  color: var(--syn-text-dim);
}
.legend {
  font-size: 19px;
  color: var(--syn-text-dim);
}
.legend::before {
  content: "";
  display: inline-block;
  width: 14px;
  height: 14px;
  border-radius: 3px;
  margin-right: 8px;
  vertical-align: -1px;
  background: linear-gradient(90deg, var(--syn-a) 50%, var(--syn-b) 50%);
}

/* 榜单标题条 */
.board-title {
  display: flex;
  align-items: baseline;
  gap: 18px;
  margin-bottom: 14px;
  font-size: 34px;
  font-weight: 900;
  letter-spacing: 6px;
}
.board-sub {
  font-size: 20px;
  font-weight: 600;
  letter-spacing: 2px;
  color: var(--syn-text-dim);
}

/* 状态卡（等待 / 未映射 / 加载 / 失败 / 空） */
.state-card {
  flex: 1;
  margin: 40px 120px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  padding: 48px;
}
.state-title {
  font-size: 44px;
  font-weight: 800;
  letter-spacing: 3px;
}
.state-body {
  font-size: 26px;
  color: var(--syn-text-dim);
  line-height: 1.6;
  text-align: center;
}
.state-detail {
  font-size: 18px;
  color: var(--syn-text-dim);
  opacity: 0.75;
  font-family: var(--el-font-family-mono, monospace);
  word-break: break-all;
}

.conn-badge {
  position: fixed;
  right: 16px;
  bottom: 14px;
  z-index: 60;
  padding: 4px 14px;
  border-radius: 999px;
  background: rgba(255, 46, 136, 0.18);
  border: 1px solid var(--syn-magenta);
  color: #ffb3d4;
  font-size: 13px;
  font-weight: 700;
}
</style>

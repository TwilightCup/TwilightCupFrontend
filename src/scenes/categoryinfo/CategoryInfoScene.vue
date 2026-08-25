<script setup lang="ts">
/**
 * 项目信息场景（原「叠加信息」透明叠加层的完全重做；舞台 scene key
 * categoryinfo，独立入口 categoryinfo.html）。
 *
 * 裁判宣布选图（pick_announced → director.currentRound.pick）后：
 * - 左侧：当前项目缩略图（与图池页同机制：logo → pickDefaultBg 官方关卡图）
 *   与项目名面板（speedrun.com 口径的项目名 + 两名选手当前项目 PB，榜内
 *   对应行成绩，未上榜 N/A）；
 * - 右侧：按选图的 speedrun.com 解析（显式映射或杯赛规则自动解析，见
 *   utils/speedrunResolve）拉取该项目排行榜 Top 15——单个霓虹 panel 紧凑
 *   排布（名次 / 选手 / 成绩 / 日期），本场选手（账号 speedrun 绑定）名称
 *   以选手色高亮。解析不出 / 拉取失败显示状态卡（与榜单同尺寸）。
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
import { bi } from "@/utils/bilingual";
import { formatRunTime } from "@/utils/format";
import { pickDefaultBg } from "@/utils/mappool";
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

const mockRows: CategoryRow[] = MOCK_LEADERBOARD.map((r) => ({
  ...r,
  highlight:
    r.playerName === MOCK_SPEEDRUN_A ? "A" : r.playerName === MOCK_SPEEDRUN_B ? "B" : null,
}));

// hook 只接真实数据：mock 模式传 null（不打真实 API，OBS 离线可调机）。
// 传整个回合而非 pick：自动解析需要消息级 collection（关卡已展开为名字；
// pick.collection 本体仍是关卡库 UUID）。
const { status, rows, errDetail, boardDisplay, pbA, pbB } = useCategoryInfo(
  computed(() => (isMock.value ? null : director.currentRound)),
  computed(() => (isMock.value ? null : director.speedrunA)),
  computed(() => (isMock.value ? null : director.speedrunB)),
);

/** mock 模式直接用静态榜（不打真实 API，OBS 离线可调机） */
const displayRows = computed<CategoryRow[]>(() =>
  isMock.value ? mockRows : rows.value,
);
const displayStatus = computed(() => (isMock.value ? "ok" : status.value));

// ── 当前选图（缩略图跟随） ────────────────────────────
const currentPick = computed(() =>
  isMock.value ? MOCK_CATEGORY_PICK : (director.currentRound?.pick ?? null),
);

/** 项目缩略图：与图池页同机制（自定义 logo → pickDefaultBg 官方关卡图） */
const thumbUrl = computed(() => {
  const p = currentPick.value;
  if (!p) return "";
  return p.logo_url || pickDefaultBg(p) || "";
});

/**
 * 项目名（speedrun.com 口径，不含 Solo / PC）：
 * Checkpoint 前置的全游戏类重排为「X% Checkpoint」，子分类值去 Solo 前缀
 * 与 % 后缀并跳过默认 Any%，如 "Checkpoint Aztec%" + Solo Glitchless →
 * 「Aztec% Checkpoint Glitchless」；IL 前置关卡名。
 */
const projectTitle = computed(() => {
  if (isMock.value) return "Any%";
  const d = boardDisplay.value;
  if (!d) return currentPick.value?.name ?? "";
  // 扩展子游戏分类（No Checkpoint% / Jumpless%）：项目本身在子分类值里，
  // 标题 = 「项目% · 词条 · 其余子分类」，如 "Any% No Checkpoint"
  const extMatch = d.categoryName.match(/^(No Checkpoint|Jumpless)%$/i);
  if (extMatch) {
    const proj = d.valueLabels.map((s) => s.trim()).find((s) => s.endsWith("%")) ?? "";
    const rest: string[] = [];
    for (const label of d.valueLabels) {
      const l = label.replace(/^Solo\s+/i, "").trim();
      if (!l || l.endsWith("%") || normEq(l, "Solo")) continue;
      if (!rest.some((p) => normEq(p, l))) rest.push(l);
    }
    return [proj, extMatch[1], ...rest].filter(Boolean).join(" ");
  }
  const parts: string[] = [];
  let cat = d.categoryName;
  let checkpoint = false;
  if (/^Checkpoint\s+/.test(cat)) {
    cat = cat.replace(/^Checkpoint\s+/, "");
    checkpoint = true;
  } else if (normEq(cat, "Checkpoint%")) {
    cat = "";
    checkpoint = true;
  }
  if (cat && !normEq(cat, "PC")) parts.push(cat);
  if (checkpoint) parts.push("Checkpoint");
  if (d.levelName) parts.unshift(d.levelName);
  for (const label of d.valueLabels) {
    const l = label.replace(/^Solo\s+/i, "").replace(/%$/, "").trim();
    // Glitches allowed / No Pinch 是每关子分类的默认值（分别对应 Glitchless /
    // Pinch 的反义），不展示
    if (
      !l ||
      normEq(l, "Any") ||
      normEq(l, "Solo") ||
      normEq(l, "Glitches allowed") ||
      normEq(l, "No Pinch")
    ) {
      continue;
    }
    if (!parts.some((p) => normEq(p, l))) parts.push(l);
  }
  return parts.join(" ");
});

function normEq(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

// ── 选手当前项目 PB 文本（三态：待拉取 → 空串；无成绩 → N/A；有 → 时间）──
function pbTextOf(side: "A" | "B"): string {
  if (isMock.value) {
    return formatRunTime(mockRows.find((r) => r.highlight === side)?.timeSec ?? null);
  }
  const pb = (side === "A" ? pbA : pbB).value;
  if (pb === undefined) return ""; // 新选图已宣布、PB 未拉到：显示空串
  return formatRunTime(pb?.timeSec ?? null); // 无成绩照旧 N/A
}
const pbTimeA = computed(() => pbTextOf("A"));
const pbTimeB = computed(() => pbTextOf("B"));
const nameA = computed(() => (isMock.value ? MOCK_TOPBAR.nameA : director.nameA));
const nameB = computed(() => (isMock.value ? MOCK_TOPBAR.nameB : director.nameB));

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
            <div class="left-col">
              <div class="thumb-panel neon-panel">
                <img v-if="thumbUrl" :src="thumbUrl" alt="" />
                <div class="scrim-top"></div>
                <div class="scrim-bottom"></div>
                <div class="proj-name">{{ projectTitle }}</div>
                <div class="thumb-footer">
                  <div class="player-slot">
                    <span class="p-name a">{{ nameA }}</span>
                    <span class="p-pb">{{ pbTimeA }}</span>
                  </div>
                  <div class="player-slot">
                    <span class="p-pb">{{ pbTimeB }}</span>
                    <span class="p-name b">{{ nameB }}</span>
                  </div>
                </div>
              </div>
            </div>
            <div class="panel-box">
              <LeaderboardTable :rows="mockRows" />
            </div>
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
            <div class="left-col">
              <!-- 项目缩略图（logo → 官方关卡图，覆盖整卡、圆角）：
                   上下黑色渐变内边衬文本；左上项目名，底部两侧选手名 + PB -->
              <div class="thumb-panel neon-panel">
                <img v-if="thumbUrl" :src="thumbUrl" alt="" />
                <div class="scrim-top"></div>
                <div class="scrim-bottom"></div>
                <div class="proj-name">{{ projectTitle }}</div>
                <div class="thumb-footer">
                  <div class="player-slot">
                    <span class="p-name a">{{ nameA }}</span>
                    <span class="p-pb">{{ pbTimeA }}</span>
                  </div>
                  <div class="player-slot">
                    <span class="p-pb">{{ pbTimeB }}</span>
                    <span class="p-name b">{{ nameB }}</span>
                  </div>
                </div>
              </div>
            </div>
            <div class="panel-box">
              <!-- 状态卡：等待选图 / 未映射 / 加载 / 失败 / 空榜（与榜单同尺寸） -->
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
  flex-direction: row;
  align-items: center;
  /* 左缘与右缘均只留 12px；左列与榜单间 12px 空隙 */
  padding: 148px 12px 56px 12px;
  gap: 12px;
}

/* 左列：项目缩略图卡，撑满榜单左侧的剩余宽度（左贴画面左缘、右贴榜单
   卡片左缘），与榜单同高、垂直居中 */
.left-col {
  height: 730px;
  flex: 1;
  min-width: 0;
  display: flex;
}
/* 项目缩略图：图片完全覆盖卡片、跟随圆角；上下黑色渐变内边衬文本 */
.thumb-panel {
  flex: 1;
  min-width: 0;
  position: relative;
  overflow: hidden;
}
.thumb-panel img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: inherit;
}
.scrim-top {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 170px;
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0.78), rgba(0, 0, 0, 0));
  pointer-events: none;
}
.scrim-bottom {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 150px;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.78), rgba(0, 0, 0, 0));
  pointer-events: none;
}
/* 项目名：缩略图左上角 */
.proj-name {
  position: absolute;
  top: 20px;
  left: 26px;
  right: 26px;
  font-size: 44px;
  font-weight: 800;
  letter-spacing: 1px;
  color: var(--syn-text);
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.8);
  line-height: 1.25;
  word-break: break-word;
}
/* 底部选手行：A 名左 + PB 右；B PB 左 + 名右 */
.thumb-footer {
  position: absolute;
  bottom: 16px;
  left: 26px;
  right: 26px;
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 20px;
}
.player-slot {
  display: flex;
  align-items: baseline;
  gap: 14px;
  font-size: 34px;
  min-width: 0;
}
.p-name {
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.8);
}
.p-name.a {
  color: var(--syn-a);
}
.p-name.b {
  color: var(--syn-b);
}
.p-pb {
  color: var(--syn-text);
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  letter-spacing: 1px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.8);
}

/* 榜单/状态卡共用的定宽槽位：贴画面右侧，宽度 = 列内容
   （78 + 210×2 + 120 + 3×6 间距 + 2×22 panel 内边距），高度 = 15 行榜单
   （15×46 行高 + 14 分隔线 + 2×12 panel 上下内边距），两种面板外观一致 */
.panel-box {
  height: 730px;
  width: 680px;
  flex: none;
  display: flex;
}

/* 状态卡（等待 / 未映射 / 加载 / 失败 / 空），填满 panel-box（与榜单同尺寸） */
.state-card {
  flex: 1;
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
  font-family: "JetBrains Mono", ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, monospace;
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

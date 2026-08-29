<script setup lang="ts">
/**
 * 顶部信息栏（比赛详情 / 图池场景共用的全局公共顶栏，需求见
 * ignored/黄昏杯导播端比赛信息顶栏需求.md）。
 *
 * 三分区通栏（左右镜像）：
 *   左：上排 Player-A 角色胶囊（选手 A 主题色）+ 其右侧比分指示器（占原
 *       名称位），名称在标签正下方（与标签同侧边距）
 *   中：上层赛事标题（REST 赛事名，空则回退 TWILIGHT CUP）
 *       下层比赛标题胶囊（纯白填充 + 文字 SVG mask 挖孔镂空，透出背景动画；
 *       底部与选手名称底部对齐，间距公式见 .mid 注释）
 *   右：与左侧完全水平镜像，指示器从右向左点亮
 *
 * 比分指示器：获胜所需局数个正方形空心轮廓，每胜一局点亮一格（选手色 + 辉光）。
 * 数据只读 director store（hosted 模式 WS 由舞台根统一连）；赛事名组件内 REST
 * 拉取（SoonScene 同款两级回退）。mock 模式（WS 断）由父级传 mock 演示值。
 */
import { computed, onMounted, ref, watch, useId } from "vue";
import { api } from "@/api/client";
import type { TournamentOut } from "@/api/types";
import { useDirectorStore } from "@/stores/director";
import { useSceneContext } from "@/scenes/composables/useSceneContext";
import { bi } from "@/utils/bilingual";

/** mock 模式演示值（MatchScene WS 断线 / 无 match 时传入） */
export interface TopBarMock {
  tournamentName: string;
  matchName: string;
  nameA: string;
  nameB: string;
  winsA: number;
  winsB: number;
  /** 指示器格数（= 获胜所需局数） */
  pipCount: number;
}

const props = defineProps<{ mock?: TopBarMock }>();

const director = useDirectorStore();
const { params } = useSceneContext();

/** 镂空 mask id（stage 交叉切换期新旧场景共存，useId 保证文档内唯一） */
const knockMaskId = `ktb-${useId()}`;

// ---- 赛事名：REST 两级回退（单端点 → 列表匹配；再失败渲染端回退品牌名） ----
const tournamentName = ref("");
/** 生效赛事 id：store 的（auth_ok → getMyMatch 回填）优先，独立图池入口退 URL */
const tid = computed(() => director.tournamentId || params.tournamentId);

async function loadTournament(): Promise<void> {
  const id = tid.value;
  if (!params.token || !id) return;
  // 单赛事端点：默认赛事（孤立比赛容器）不在 /me/tournaments 列表里，
  // 但比赛参与者可经它读到赛事名。
  try {
    tournamentName.value = (await api.getMyTournament(id, params.token)).name || "";
    return;
  } catch {
    // 端点不可用（旧后端）/ 无权限 → 再试列表端点兜底
  }
  try {
    const list = await api.listMyTournaments(params.token);
    tournamentName.value =
      (list.find((x: TournamentOut) => x.id === id) ?? null)?.name || "";
  } catch {
    // 非赛事成员 / 网络失败：留空，渲染端回退品牌名
  }
}

onMounted(() => void loadTournament());
// auth_ok 后 store 才有 tournamentId（独立入口首拉为空操作），到值时补拉
watch(tid, (nv, ov) => {
  if (nv && nv !== ov) void loadTournament();
});

// ---- 展示字段（mock 优先，其余读 store） ----
const eventName = computed(
  () => props.mock?.tournamentName || tournamentName.value || bi("scenes.topbar.brandFallback"),
);
const matchTitle = computed(() => props.mock?.matchName ?? director.matchName);
const nameA = computed(() => props.mock?.nameA ?? director.nameOf("A"));
const nameB = computed(() => props.mock?.nameB ?? director.nameOf("B"));
const winsA = computed(() => props.mock?.winsA ?? director.winsA);
const winsB = computed(() => props.mock?.winsB ?? director.winsB);

/** 指示器格数：WS threshold > REST win_threshold > 由 BO 推导；均未知则隐藏 */
const pipCount = computed(() => {
  if (props.mock) return props.mock.pipCount;
  return (
    director.threshold ||
    director.winThreshold ||
    (director.boFormat >= 1 ? Math.floor(director.boFormat / 2) + 1 : 0)
  );
});
</script>

<template>
  <header class="topbar">
    <!-- 选手 A：上排角色胶囊 + 比分指示器（紧邻标签右侧，从左向右点亮），
         名称/ID 在标签正下方（与标签同侧边距） -->
    <div class="side a">
      <div class="head">
        <span class="role-tag">{{ bi("scenes.topbar.playerA") }}</span>
        <ul v-if="pipCount > 0" class="pips">
          <li
            v-for="i in pipCount"
            :key="i"
            class="pip"
            :class="{ lit: i <= winsA }"
          />
        </ul>
      </div>
      <div class="who">
        <span class="name">{{ nameA }}</span>
      </div>
    </div>

    <!-- 中间：赛事标题 + 白底镂空比赛标题胶囊 -->
    <div class="mid">
      <div class="event">{{ eventName }}</div>
      <!-- 白底胶囊 + 文本 mask 挖真孔（技术同 CtTagBoard/MapCard）：孔内直接
           透出背景动画；ghost 文本只撑尺寸（与 mask 文本同字体度量） -->
      <span v-if="matchTitle" class="match-pill">
        <svg class="knock" aria-hidden="true">
          <defs>
            <mask :id="knockMaskId" maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%">
              <rect x="0" y="0" width="100%" height="100%" fill="#fff" />
              <text
                class="knock-text"
                x="50%"
                y="50%"
                text-anchor="middle"
                dominant-baseline="central"
                fill="#000"
              >
                {{ matchTitle }}
              </text>
            </mask>
          </defs>
          <rect
            class="knock-fill"
            x="0"
            y="0"
            width="100%"
            height="100%"
            :mask="`url(#${knockMaskId})`"
          />
        </svg>
        <span class="txt ghost">{{ matchTitle }}</span>
      </span>
    </div>

    <!-- 选手 B：完全水平镜像（胶囊贴最右、比分紧邻其左从右向左点亮、名称右对齐） -->
    <div class="side b">
      <div class="head">
        <span class="role-tag">{{ bi("scenes.topbar.playerB") }}</span>
        <ul v-if="pipCount > 0" class="pips">
          <li
            v-for="i in pipCount"
            :key="i"
            class="pip"
            :class="{ lit: i <= winsB }"
          />
        </ul>
      </div>
      <div class="who">
        <span class="name">{{ nameB }}</span>
      </div>
    </div>
  </header>
</template>

<style scoped>
/* 三分区通栏：两侧 1fr（min-width:0 允许压缩保中央真居中），中央自适应；
   内容整体贴栏顶（栏再由宿主贴画面顶部）。设计 px 基于 1920×1080 画布
   （mappool 板内坐标系；match 场景视口即同尺寸） */
.topbar {
  width: 100%;
  height: 104px;
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: start;
  column-gap: 28px;
}
/* 选手区：上排 .head（标签 + 比分同行，比分紧贴标签不受名称宽度影响），
   下排名称/ID 与标签同侧边距（flex 列起点对齐）。
   顶部下沉 + 侧面留边（侧边距与顶边距一致） */
.side {
  min-width: 0;
  padding: 10px 10px 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}
/* B 侧镜像：整组贴右 */
.side.b {
  align-items: flex-end;
}
.head {
  display: flex;
  align-items: center;
  gap: 20px;
}
.side.b .head {
  flex-direction: row-reverse;
}
/* 选手主题色（角色胶囊与点亮方块共用；辉光 rgba 对同 MapCard） */
.side.a {
  --pc: var(--syn-a);
  --pc-glow: var(--syn-a-glow, rgba(61, 139, 255, 0.55));
}
.side.b {
  --pc: var(--syn-b);
  --pc-glow: var(--syn-b-glow, rgba(255, 107, 74, 0.55));
}
/* 角色标识胶囊：纯色底 + 纯白文本，收紧内边距贴合文本 */
.role-tag {
  font-size: 16px;
  font-weight: 800;
  letter-spacing: 1px;
  line-height: 1;
  padding: 4px 0.8em;
  border-radius: 999px;
  background: var(--pc);
  color: #fff;
  white-space: nowrap;
}
/* 名称：B 侧右对齐；超长省略号保护布局 */
.who {
  min-width: 0;
}
.side.b .who {
  align-items: flex-end;
  text-align: right;
}
.name {
  max-width: 24ch;
  font-size: 34px;
  font-weight: 900;
  line-height: 1.15;
  color: var(--syn-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: 0 2px 10px rgba(10, 1, 24, 0.6);
}
/* 比分指示器：胜局数个正方形空心轮廓；B 侧 row-reverse → 从右向左点亮 */
.pips {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  gap: 8px;
}
.side.b .pips {
  flex-direction: row-reverse;
}
.pip {
  width: 22px;
  height: 22px;
  border: 2px solid rgba(245, 247, 255, 0.34);
  border-radius: 3px;
  transition:
    background 0.25s ease,
    border-color 0.25s ease,
    box-shadow 0.25s ease;
}
.pip.lit {
  border-color: var(--pc);
  background: var(--pc);
  box-shadow:
    0 0 12px var(--pc-glow),
    0 0 3px var(--pc-glow);
}
/* 中央：上层赛事标题，下层比赛标题胶囊（顶部与两侧同幅下沉）。
   间距按「胶囊底部 = 选手名称底部」对齐公式求得（自画面顶算起）：
   名称底 = 10(顶距) + 26(标签/比分行) + 8(行距) + 34×1.15(名称行) = 83.1
   胶囊底 = 10(顶距) + 36(赛事行 line-height) + gap + 26(胶囊高) → gap = 11.1
   （改 .head/.side gap/.name/.event/.match-pill 任一尺寸时同步此值） */
.mid {
  min-width: 0;
  padding-top: 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 11.1px;
}
.event {
  max-width: 46ch;
  /* 辉光呼吸空间：text-shadow 会被自身的 overflow:hidden（省略号保护）在
     盒缘截断——用 padding 外扩 + 等量负 margin 保持占位、间距、视觉位置
     全部不变，只是把裁剪边界推远（模糊半径 18px < 外扩 20px） */
  padding: 20px 24px;
  margin: -20px -24px;
  font-size: 30px;
  /* 行高定值：胶囊与名称的底部对齐公式依赖确定行高（见 .mid 注释） */
  line-height: 36px;
  font-weight: 900;
  letter-spacing: 4px;
  color: var(--syn-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow:
    0 0 18px rgba(34, 227, 255, 0.35),
    0 2px 8px rgba(10, 1, 24, 0.55);
}
/* 白底胶囊：文本镂空由下方 SVG 层绘制，本层文字转透明只撑尺寸；
   字体度量（字号/字重/字距）必须与 .knock-text 完全一致，孔位才对齐 */
.match-pill {
  position: relative;
  display: inline-block;
  max-width: 100%;
  font-size: 19px;
  font-weight: 800;
  letter-spacing: 1px;
  line-height: 26px;
  padding: 0 0.9em;
  border-radius: 999px;
  white-space: nowrap;
  overflow: hidden;
  color: transparent;
}
.txt.ghost {
  visibility: hidden;
}
/* 镂空 SVG：rect 填纯白、文本 mask 挖孔，孔内直接透出背景动画。rect 不带 rx
   ——SVG 的 rx/ry 各自钳位，宽扁矩形会退化成内切椭圆；胶囊形由 CSS
   border-radius 裁剪才正确（同 CtTagBoard）。尺寸必须显式给：svg 是替换
   元素，只写 inset 不会拉伸，会回落到固有尺寸 300×150 */
.knock {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  border-radius: 999px;
  overflow: hidden;
  pointer-events: none;
}
.knock-fill {
  fill: #fff;
}
.knock-text {
  font-family: inherit;
  font-size: 19px;
  font-weight: 800;
  letter-spacing: 1px;
}
</style>

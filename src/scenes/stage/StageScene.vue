<script setup lang="ts">
/**
 * 合并舞台根：一个 OBS 浏览器源承载 5 个场景，导播控制台经 WS 广播切换。
 *
 * 职责：
 *  1. 读一次 URL（token/match/tournament/...）—— 舞台 URL 由导播控制台拼好（含 tournament）。
 *  2. 连唯一 director store WS（内嵌场景不得再连，由 useSceneContext.hosted 守卫）。
 *  3. provide SceneContext（hosted:true, sharedBg:true, sharedTopBar:true）
 *    给 5 个内嵌场景。
 *  4. 渲染单个共享 SynthwaveBg + <Transition> 在 5 场景间交叉淡入切换。
 *  5. 监听 WS director_cmd 消息 + localStorage 兜底（同进程 Chrome 标签页）即时切换。
 *  6. 顶部信息栏常驻单实例（仅 match/mappool 场景显示，v-show 切换不重挂）：
 *    跨场景切换零闪烁——两场景各自内嵌的顶栏在 hosted 模式下让位（sharedTopBar）。
 */
import { computed, onMounted, onUnmounted, provide, ref, shallowRef, watch } from "vue";
import { useDirectorStore } from "@/stores/director";
import SynthwaveBg from "@/scenes/components/SynthwaveBg.vue";
import TopBar from "@/scenes/components/TopBar.vue";
import { useSceneParams } from "@/scenes/composables/useSceneParams";
import {
  SCENE_CONTEXT_KEY,
  type SceneContext,
} from "@/scenes/composables/useSceneContext";
import {
  bindStageScene,
  type SceneKey,
} from "./useStageScene";
import Overlay from "@/overlay/Overlay.vue";
import MatchScene from "@/scenes/match/MatchScene.vue";
import MappoolScene from "@/scenes/mappool/MappoolScene.vue";
import BracketScene from "@/scenes/bracket/BracketScene.vue";
import SoonScene from "@/scenes/soon/SoonScene.vue";

const params = useSceneParams();
const director = useDirectorStore();

// 内嵌场景：host 管 WS + 提供共享背景与常驻顶栏
provide<SceneContext>(SCENE_CONTEXT_KEY, {
  params,
  hosted: true,
  sharedBg: true,
  sharedTopBar: true,
});

const currentScene = ref<SceneKey>("match");
/** 顶栏只在带选手/比赛信息的两场景显示（同实例 v-show，切换不闪） */
const showTopBar = computed(
  () => currentScene.value === "match" || currentScene.value === "mappool",
);
let unbind: (() => void) | null = null;

onMounted(() => {
  if (params.token) director.connect(params.token, params.matchId || undefined);
  unbind = bindStageScene(currentScene);

  // WS 广播：控制台发 director_cmd → store 更新 currentSceneCmd → 舞台切场景
  const unwatch = watch(
    () => director.currentSceneCmd,
    (scene) => { if (scene) currentScene.value = scene as SceneKey; },
  );
  onUnmounted(() => unwatch());
});
onUnmounted(() => {
  unbind?.();
  director.disconnect();
});

/** 当前场景组件（响应式） */
const sceneMap: Record<SceneKey, typeof Overlay> = {
  overlay: Overlay,
  match: MatchScene,
  mappool: MappoolScene,
  bracket: BracketScene,
  soon: SoonScene,
};
const activeComponent = shallowRef<typeof Overlay>(sceneMap[currentScene.value]);
// 切换时同步组件引用（Transition 用 key 区分，组件引用也跟着换）
function syncComponent(): void {
  activeComponent.value = sceneMap[currentScene.value];
}
watch(currentScene, syncComponent, { immediate: true });
</script>

<template>
  <div class="stage">
    <SynthwaveBg />

    <div class="stage-host">
      <Transition name="scene-xfade" mode="default">
        <component :is="activeComponent" :key="currentScene" />
      </Transition>
    </div>

    <!-- 常驻顶栏：切场景不重挂（同实例），进出带顶栏的场景组时淡入淡出
         （match↔mappool 间 showTopBar 不变，不触发任何过渡） -->
    <Transition name="topbar-fade">
      <TopBar v-show="showTopBar" class="stage-top" />
    </Transition>
  </div>
</template>

<style scoped>
.stage {
  position: relative;
  height: 100%;
  overflow: hidden;
}
.stage-host {
  position: relative;
  height: 100%;
  width: 100%;
}
/* 常驻顶栏：贴舞台顶、铺满宽，压在全部场景层之上（场景内已让位） */
.stage-top {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 30;
}

/* 场景交叉淡入：切换瞬间新旧场景短暂重叠（absolute 定位） */
.scene-xfade-enter-active,
.scene-xfade-leave-active {
  transition: opacity 0.45s ease;
  position: absolute;
  inset: 0;
}
.scene-xfade-enter-from {
  opacity: 0;
}
.scene-xfade-leave-to {
  opacity: 0;
}

/* 常驻顶栏显隐过渡：与场景交叉淡入同节奏（v-show 切换，元素不重挂） */
.topbar-fade-enter-active,
.topbar-fade-leave-active {
  transition: opacity 0.45s ease;
}
.topbar-fade-enter-from,
.topbar-fade-leave-to {
  opacity: 0;
}
</style>

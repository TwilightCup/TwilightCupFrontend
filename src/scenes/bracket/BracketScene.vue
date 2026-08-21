<script setup lang="ts">
/**
 * 赛程图场景页根组件。
 *
 * 合成器浪潮背景之上展示完整淘汰赛对阵树（单/双败）。token 从 URL ?token= 取，
 * ?tournament= 指定赛事。导播 token 因对阵端点 admin-only → mock 兜底 + 角标。
 */
import { computed, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import SynthwaveBg from "@/scenes/components/SynthwaveBg.vue";
import { useSceneContext } from "@/scenes/composables/useSceneContext";
import { bi } from "@/utils/bilingual";
import { useBracketData } from "./useBracketData";
import BracketTree from "./BracketTree.vue";

const { t } = useI18n();
const { params, sharedBg } = useSceneContext();
const { bracket, isMock, load, stop, scores, names } = useBracketData();

const tournamentTitle = computed(() =>
  params.tournamentId
    ? bi("scenes.bracket.title")
    : bi("scenes.bracket.mockHint"),
);

function nameOf(id: string | null): string {
  if (!id) return bi("scenes.bracket.tbd");
  return names.value.get(id) ?? id.slice(0, 8);
}

onMounted(() => {
  void load(params.token, params.tournamentId);
});
onUnmounted(stop);
</script>

<template>
  <div class="scene scanlines">
    <SynthwaveBg v-if="!sharedBg" />

    <div v-if="!params.token" class="notice">
      <div class="notice-card neon-panel">{{ t("scenes.noToken") }}</div>
    </div>

    <template v-else>
      <div class="content">
        <header class="head">
          <h1 class="title neon-text">{{ tournamentTitle }}</h1>
        </header>
        <div class="tree-wrap">
          <BracketTree
            v-if="bracket"
            :bracket="bracket"
            :scores="scores"
            :name-of="nameOf"
          />
          <div v-else class="loading">{{ tournamentTitle }}</div>
        </div>
      </div>

      <div v-if="isMock" class="mock-badge">{{ t("scenes.mockBadge") }}</div>
    </template>
  </div>
</template>

<style scoped>
.scene {
  position: relative;
  height: 100%;
}
.content {
  position: relative;
  z-index: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 2vh 3vw 3vh;
}
.head {
  padding-bottom: 1.4vh;
}
.title {
  margin: 0;
  font-size: clamp(22px, 3vw, 48px);
  font-weight: 900;
  letter-spacing: 2px;
}
.tree-wrap {
  flex: 1;
  min-height: 0;
}
.loading {
  color: var(--syn-text-dim);
  text-align: center;
  padding: 60px 0;
}
.notice {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.notice-card {
  padding: 24px 32px;
  font-size: 15px;
}
</style>

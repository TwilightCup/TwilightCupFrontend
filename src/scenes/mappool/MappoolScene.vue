<script setup lang="ts">
/**
 * 图池场景页根组件。
 *
 * 合成器浪潮背景之上展示整池图（按类别分组的方框网格，每图配纯色底占位）。
 * token 从 URL ?token= 取；?match= 指定比赛则取其图池（getMyMatch），否则 mock。
 */
import { onMounted } from "vue";
import { useI18n } from "vue-i18n";
import SynthwaveBg from "@/scenes/components/SynthwaveBg.vue";
import { useSceneContext } from "@/scenes/composables/useSceneContext";
import { useMappoolData } from "./useMappoolData";
import { categoryKindInfo } from "@/utils/format";
import { bi } from "@/utils/bilingual";
import MapCard from "./MapCard.vue";

const { t } = useI18n();
const { params, sharedBg } = useSceneContext();
const { groups, isMock, load } = useMappoolData();

onMounted(() => {
  void load(params.token, params.matchId, params.tournamentId);
});

function kindLabel(kind: string): string {
  return categoryKindInfo(kind)?.label ?? kind;
}
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
          <h1 class="title neon-text">{{ bi("scenes.mappool.title") }}</h1>
        </header>

        <div class="scroll">
          <section v-for="g in groups" :key="g.kind" class="group">
            <h2 class="group-title neon-text-magenta">{{ kindLabel(g.kind) }}</h2>
            <div class="grid">
              <MapCard v-for="p in g.picks" :key="p.code" :pick="p" :kind="g.kind" />
            </div>
          </section>
          <div v-if="groups.length === 0" class="empty">{{ bi("scenes.mappool.empty") }}</div>
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
}
.head {
  padding: 2.4vh 4vw 1.4vh;
}
.title {
  margin: 0;
  font-size: clamp(26px, 3.6vw, 56px);
  font-weight: 900;
  letter-spacing: 2px;
}
.scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 4vw 4vh;
  display: flex;
  flex-direction: column;
  gap: 2.6vh;
}
.group {
  display: flex;
  flex-direction: column;
  gap: 1.2vh;
}
.group-title {
  margin: 0;
  font-size: clamp(16px, 1.8vw, 26px);
  font-weight: 800;
  letter-spacing: 1px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 1.4vw;
}
.empty {
  color: var(--syn-text-dim);
  text-align: center;
  padding: 60px 0;
  font-size: 16px;
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

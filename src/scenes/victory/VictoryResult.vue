<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useDirectorStore } from "@/stores/director";
import { bi } from "@/utils/bilingual";

const props = defineProps<{ bilingual?: boolean }>();
const { t } = useI18n();
const director = useDirectorStore();
const winner = computed(() => director.matchWinner);
const winnerName = computed(() => winner.value ? director.nameOf(winner.value) : "");
const waitingKey = computed(() => director.matchEnded ? "scenes.victory.missingWinner" : "scenes.victory.waiting");
function label(key: string): string {
  return props.bilingual ? bi(key) : t(key);
}
</script>

<template>
  <section class="victory-result" :class="{ 'winner-a': winner === 'A', 'winner-b': winner === 'B' }" aria-live="polite">
    <div class="result-title">{{ label("scenes.victory.title") }}</div>
    <div v-if="director.matchName" class="match-name">{{ director.matchName }}</div>
    <template v-if="winner">
      <svg class="trophy" viewBox="0 0 64 64" aria-hidden="true">
        <path d="M18 8h28v16c0 10-6 18-14 18s-14-8-14-18V8Zm0 5H8v9c0 8 5 13 13 13M46 13h10v9c0 8-5 13-13 13M32 42v12M20 56h24" />
      </svg>
      <div class="winner-label">{{ label("scenes.victory.winner") }}</div>
      <h1 class="winner-name">{{ winnerName }}</h1>
    </template>
    <p v-else class="waiting">{{ label(waitingKey) }}</p>
    <div v-if="winner && director.resultScoreReady" class="scoreboard">
      <div class="score-label">{{ label("scenes.victory.score") }}</div>
      <div class="score-row">
        <div class="player player-a" :class="{ won: winner === 'A' }">
          <div class="player-name">{{ director.nameOf("A") }}</div>
          <strong>{{ director.winsA }}</strong>
        </div>
        <span class="separator">:</span>
        <div class="player player-b" :class="{ won: winner === 'B' }">
          <div class="player-name">{{ director.nameOf("B") }}</div>
          <strong>{{ director.winsB }}</strong>
        </div>
      </div>
    </div>
    <p v-else-if="winner" class="waiting">{{ label("scenes.victory.missingScore") }}</p>
    <div v-if="director.boFormat > 0" class="format">{{ label("scenes.victory.format") }} · BO{{ director.boFormat }}</div>
  </section>
</template>

<style scoped>
.victory-result {
  --winner-color: var(--syn-win, #ffd166);
  position: relative;
  color: #f5f7ff;
  background: rgba(26, 6, 51, 0.82);
  border: 1px solid rgba(255, 209, 102, 0.45);
  border-radius: 24px;
  padding: clamp(24px, 4vw, 64px);
  text-align: center;
  overflow-wrap: anywhere;
}
.winner-a { --winner-color: var(--syn-a, #3d8bff); }
.winner-b { --winner-color: var(--syn-b, #ff6b4a); }
.result-title, .winner-label, .score-label, .format { font-size: clamp(14px, 1.4vw, 24px); }
.result-title { color: #ffd166; letter-spacing: 0.12em; font-weight: 700; }
.match-name { margin-top: 12px; font-size: clamp(16px, 1.8vw, 30px); }
.trophy { width: clamp(48px, 6vw, 100px); margin: 24px auto 8px; fill: none; stroke: #ffd166; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
.winner-label { color: #ffd166; }
.winner-name { color: var(--winner-color); font-size: clamp(28px, 5vw, 80px); line-height: 1.2; margin: 12px 0 24px; text-shadow: 0 0 28px color-mix(in srgb, var(--winner-color) 40%, transparent); }
.scoreboard { max-width: 850px; margin: auto; }
.score-label, .format { color: #a99bd6; }
.score-row { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: end; gap: 20px; margin-top: 16px; }
.player-name { font-size: clamp(16px, 2vw, 32px); }
.player-a { color: var(--syn-a, #3d8bff); }
.player-b { color: var(--syn-b, #ff6b4a); }
.player strong, .separator { font-family: "JetBrains Mono Variable", monospace; font-size: clamp(32px, 5vw, 80px); }
.won strong { text-shadow: 0 0 24px currentColor; }
.separator { color: #a99bd6; }
.format { margin-top: 24px; }
.waiting { margin: 36px 0; color: #a99bd6; font-size: clamp(18px, 2vw, 32px); }
</style>

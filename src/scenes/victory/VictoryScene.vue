<script setup lang="ts">
import VictoryResult from "./VictoryResult.vue";

// StageScene owns the socket and shared background; this scene only presents results.
</script>

<template>
  <main class="victory-scene">
    <VictoryResult bilingual class="result" />
  </main>
</template>

<style scoped>
.victory-scene {
  position: relative;
  z-index: 1;
  height: 100%;
  box-sizing: border-box;
  display: grid;
  place-items: center;
  padding: 32px;
  overflow: auto;
}
.result { width: min(100%, 1200px); box-sizing: border-box; }
</style>

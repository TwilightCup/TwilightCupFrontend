<script setup lang="ts">
import type { DirectorConfig } from "@/scenes/composables/useDirectorConfig";
import { LINK_FIELDS } from "@/stores/streamLinks";
defineProps<{ visible: boolean; model: DirectorConfig }>();
const emit = defineEmits<{ (e: "update:visible", value: boolean): void; (e: "close"): void }>();
function close() { emit("update:visible", false); emit("close"); }
</script>
<template>
  <Transition name="fade">
    <div v-if="visible" class="mask" @click.self="close">
      <div class="panel neon-panel">
        <header class="head">
          <span class="title neon-text">{{ $t("scenes.edit.title") }}</span>
          <button class="x" @click="close" aria-label="close">✕</button>
        </header>
        <p>{{ $t("streamLinks.stageReadOnly") }}</p>
        <div class="grid">
          <label v-for="key in LINK_FIELDS" :key="key" class="field">
            <span class="lbl">{{ $t(`scenes.edit.${key}`) }}</span>
            <input :value="model[key]" readonly />
          </label>
        </div>
        <footer class="foot"><button class="btn ghost" @click="close">{{ $t("scenes.edit.close") }}</button></footer>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(5, 0, 15, 0.72);
  backdrop-filter: blur(3px);
}
.panel {
  width: 640px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 48px);
  overflow: auto;
  padding: 18px 22px 16px;
  border: 1px solid var(--syn-border-bright);
  box-shadow: 0 0 40px rgba(34, 227, 255, 0.25);
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}
.title {
  font-size: 18px;
  font-weight: 800;
  letter-spacing: 0.5px;
}
.x {
  background: none;
  border: none;
  color: var(--syn-text-dim);
  font-size: 20px;
  cursor: pointer;
}
.x:hover {
  color: var(--syn-text);
}
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 16px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.lbl {
  font-size: 12px;
  color: var(--syn-text-dim);
  letter-spacing: 0.4px;
}
input {
  background: rgba(10, 1, 24, 0.7);
  border: 1px solid var(--syn-border);
  border-radius: 8px;
  color: var(--syn-text);
  padding: 7px 10px;
  font: inherit;
  font-size: 13px;
}
input:focus {
  outline: none;
  border-color: var(--syn-border-bright);
  box-shadow: 0 0 0 2px rgba(34, 227, 255, 0.18);
}
.foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 16px;
}
.btn {
  padding: 7px 18px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  border: 1px solid var(--syn-border);
}
.btn.ghost {
  background: transparent;
  color: var(--syn-text-dim);
}
.btn.primary {
  background: var(--syn-cyan);
  color: #06121a;
  border-color: var(--syn-cyan);
  box-shadow: 0 0 16px rgba(34, 227, 255, 0.5);
}
.btn.ghost:hover {
  color: var(--syn-text);
  border-color: var(--syn-border-bright);
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

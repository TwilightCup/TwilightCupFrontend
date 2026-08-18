<script setup lang="ts">
import { computed } from "vue";
import { useMatchStore } from "@/stores/match";

const match = useMatchStore();
const visible = computed(() => match.countdown !== null);
</script>

<template>
  <Transition name="fade">
    <div v-if="visible" class="countdown-banner" :class="match.countdown?.source">
      <div class="label">
        {{ match.countdown?.source === "manual" ? $t('countdown.manualLabel') : $t('countdown.autoLabel') }}
      </div>
      <div class="num">{{ match.countdown?.remaining ?? 0 }}</div>
      <div class="hint">
        {{ match.countdown?.source === "manual" ? $t('countdown.manualHint') : $t('countdown.autoHint') }}
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.countdown-banner {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 14px;
  margin-bottom: 12px;
  background: linear-gradient(135deg, #3a1414, #5a1d1d);
  border: 1px solid #7a2424;
  border-radius: 10px;
  color: #ffe3e3;
}
.countdown-banner.manual {
  background: linear-gradient(135deg, #3a2a0f, #5a3f12);
  border-color: #7a5a1c;
  color: #ffe9c2;
}
.label {
  font-size: 13px;
  letter-spacing: 1px;
}
.num {
  font-size: 46px;
  font-weight: 800;
  line-height: 1.1;
}
.hint {
  font-size: 12px;
  opacity: 0.85;
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

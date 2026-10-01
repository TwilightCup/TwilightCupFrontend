<script setup lang="ts">
import { computed } from "vue";
import { useMatchStore } from "@/stores/match";
import { useStreamLinksStore, LINK_FIELDS } from "@/stores/streamLinks";
const match = useMatchStore();
const shared = useStreamLinksStore();
const links = computed(() => shared.linksFor(match.matchId ?? ""));
</script>

<template>
  <el-dropdown trigger="click" placement="bottom-end">
    <el-button size="small">{{ $t('matchHeader.streamsBtn') }}</el-button>
    <template #dropdown>
      <el-dropdown-menu>
        <div class="streams-dd">
          <p>{{ $t('streamLinks.refereeReadOnly') }}</p>
          <p>{{ shared.loaded ? $t('streamLinks.serverVersion', { version: shared.version }) : $t('streamLinks.loading') }}</p>
          <p v-if="shared.error">{{ shared.error }}</p>
          <label v-for="key in LINK_FIELDS" :key="key" class="field">
            <span>{{ $t(`scenes.edit.${key}`) }}</span>
            <el-input :model-value="links[key]" readonly size="small" />
          </label>
          <el-button size="small" :loading="shared.loading" @click="shared.refresh()">{{ $t('streamLinks.refresh') }}</el-button>
        </div>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>
<style scoped>
.streams-dd { width: 360px; padding: 12px; }
.field { display: grid; gap: 4px; margin-bottom: 8px; }
</style>

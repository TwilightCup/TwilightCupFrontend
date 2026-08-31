<script setup lang="ts">
import { reactive, watch } from "vue";
import { ElMessage } from "element-plus";
import { useI18n } from "vue-i18n";
import { useMatchStore } from "@/stores/match";
import { useRefereeStreamConfig } from "@/composables/useRefereeStreamConfig";

const { t } = useI18n();
const match = useMatchStore();
const { config, load, save } = useRefereeStreamConfig();

const form = reactive({
  hlsA: "",
  hlsB: "",
  embedA: "",
  embedB: "",
});

watch(
  () => match.matchId,
  (id) => {
    if (id) load(id, {});
  },
  { immediate: true },
);

function onVisibleChange(open: boolean): void {
  if (open) {
    form.hlsA = config.hlsA;
    form.hlsB = config.hlsB;
    form.embedA = config.embedA;
    form.embedB = config.embedB;
  }
}

function saveStreams(): void {
  if (!match.matchId) {
    ElMessage.warning(t("matchHeader.streamsNoMatch"));
    return;
  }
  save(match.matchId, { ...form });
  ElMessage.success(t("matchHeader.streamsSaved"));
}
</script>

<template>
  <el-dropdown trigger="click" placement="bottom-end" @visible-change="onVisibleChange">
    <el-button size="small">{{ $t('matchHeader.streamsBtn') }}</el-button>
    <template #dropdown>
      <el-dropdown-menu>
        <div class="streams-dd">
          <div class="cfg-grid">
            <label class="cfg-field">
              <span class="lbl">{{ $t("scenes.edit.hlsA") }}</span>
              <el-input v-model="form.hlsA" size="small" placeholder="https://.../a.m3u8" />
            </label>
            <label class="cfg-field">
              <span class="lbl">{{ $t("scenes.edit.hlsB") }}</span>
              <el-input v-model="form.hlsB" size="small" placeholder="https://.../b.m3u8" />
            </label>
            <label class="cfg-field">
              <span class="lbl">{{ $t("scenes.edit.embedA") }}</span>
              <el-input v-model="form.embedA" size="small" />
            </label>
            <label class="cfg-field">
              <span class="lbl">{{ $t("scenes.edit.embedB") }}</span>
              <el-input v-model="form.embedB" size="small" />
            </label>
          </div>
          <div class="cfg-foot">
            <el-button size="small" type="primary" @click="saveStreams">
              {{ $t("common.save") }}
            </el-button>
          </div>
        </div>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<style scoped>
.streams-dd {
  width: 480px;
  padding: 10px 12px;
  box-sizing: border-box;
}
.cfg-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 12px;
}
.cfg-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.cfg-field .lbl {
  font-size: 11px;
  color: var(--tc-text-dim);
}
.cfg-foot {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}
</style>

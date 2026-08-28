<script setup lang="ts">
/**
 * 导播配置弹层：编辑选手 A/B 的 HLS 流地址 + 外部直播嵌入地址。
 *
 * 由 ?edit=1 自动唤起，或齿轮按钮手动唤起。保存即写 localStorage 并 emit('saved')，
 * 场景页据此实时反映。OBS 抓图前应关闭此面板（点遮罩或保存均可）。
 *
 * 纯原生表单（不引 Element Plus，与 overlay 轻量入口一致）。
 */
import { reactive, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { DirectorConfig } from "@/scenes/composables/useDirectorConfig";

const props = defineProps<{
  visible: boolean;
  /** 打开时回显的当前配置 */
  model: DirectorConfig;
}>();
const emit = defineEmits<{
  (e: "update:visible", v: boolean): void;
  (e: "saved", patch: Partial<DirectorConfig>): void;
  (e: "close"): void;
}>();

const { t } = useI18n();

// 表单本地副本（编辑中不直接改 props.model，取消可回退）
const form = reactive<DirectorConfig>({ ...props.model });
watch(
  () => props.visible,
  (v) => {
    if (v) Object.assign(form, props.model);
  },
);

interface Field {
  key: keyof DirectorConfig;
  label: string;
  placeholder: string;
}

const fields: Field[] = [
  { key: "hlsA", label: t("scenes.edit.hlsA"), placeholder: "https://.../a.m3u8" },
  { key: "hlsB", label: t("scenes.edit.hlsB"), placeholder: "https://.../b.m3u8" },
  { key: "embedA", label: t("scenes.edit.embedA"), placeholder: "B站房间号/直播间链接 或 YouTube 直播/视频链接（自动转嵌入）" },
  { key: "embedB", label: t("scenes.edit.embedB"), placeholder: "B站房间号/直播间链接 或 YouTube 直播/视频链接（自动转嵌入）" },
];

function close(): void {
  emit("update:visible", false);
  emit("close");
}
function save(): void {
  emit("saved", { ...form });
  emit("update:visible", false);
}
</script>

<template>
  <Transition name="fade">
    <div v-if="visible" class="mask" @click.self="close">
      <div class="panel neon-panel">
        <header class="head">
          <span class="title neon-text">{{ t("scenes.edit.title") }}</span>
          <button class="x" @click="close" aria-label="close">✕</button>
        </header>

        <div class="grid">
          <label v-for="f in fields" :key="f.key" class="field">
            <span class="lbl">{{ f.label }}</span>
            <input v-model="form[f.key]" :placeholder="f.placeholder" />
          </label>
        </div>

        <footer class="foot">
          <button class="btn ghost" @click="close">{{ t("scenes.edit.close") }}</button>
          <button class="btn primary" @click="save">{{ t("scenes.edit.save") }}</button>
        </footer>
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

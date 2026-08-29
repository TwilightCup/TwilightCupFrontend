<script setup lang="ts">
/**
 * 颜色选择控件：一个颜色预览方块，点击后打开面板，内含原生颜色选择器与
 * HEX 编码输入框。输入只接受 6 位 HEX（无透明度），始终按完全不透明处理。
 */
import { ref, watch } from "vue";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    label?: string;
    disabled?: boolean;
  }>(),
  {
    label: "",
    disabled: false,
  },
);
const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
}>();

const open = ref(false);
const draft = ref(stripHash(props.modelValue));

function stripHash(value: string): string {
  return value.replace(/^#/, "").replace(/[^0-9a-f]/gi, "").slice(0, 6);
}

watch(
  () => props.modelValue,
  (v) => {
    draft.value = stripHash(v);
  },
);
watch(open, (v) => {
  if (v) draft.value = stripHash(props.modelValue);
});

function onColorInput(e: Event): void {
  const v = (e.target as HTMLInputElement).value;
  if (v) emit("update:modelValue", v.toLowerCase());
}

function onHexInput(e: Event): void {
  draft.value = stripHash((e.target as HTMLInputElement).value);
}

function commitHex(): void {
  if (/^[0-9a-f]{6}$/i.test(draft.value)) {
    emit("update:modelValue", `#${draft.value.toLowerCase()}`);
  } else {
    draft.value = stripHash(props.modelValue);
  }
}
</script>

<template>
  <el-popover
    v-model:visible="open"
    trigger="click"
    placement="bottom-start"
    :width="260"
    :disabled="disabled"
    :teleported="true"
  >
    <template #reference>
      <button
        type="button"
        class="color-swatch"
        :style="{ backgroundColor: modelValue }"
        :disabled="disabled"
        :aria-label="label"
        :title="modelValue"
      ></button>
    </template>

    <div class="color-pop">
      <input
        class="native-color"
        type="color"
        :value="modelValue"
        :disabled="disabled"
        :aria-label="label"
        @input="onColorInput"
      />
      <div class="hex-field">
        <span class="hash">#</span>
        <input
          class="hex-input"
          :value="draft"
          maxlength="6"
          :disabled="disabled"
          placeholder="RRGGBB"
          spellcheck="false"
          @input="onHexInput"
          @blur="commitHex"
          @keydown.enter="commitHex"
        />
      </div>
    </div>
  </el-popover>
</template>

<style scoped>
.color-swatch {
  width: 40px;
  height: 40px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 8px;
  padding: 0;
  cursor: pointer;
  box-shadow: 0 0 8px rgba(0, 0, 0, 0.35);
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
  flex-shrink: 0;
}
.color-swatch:hover:not(:disabled) {
  border-color: var(--tc-primary, #22e3ff);
  box-shadow: 0 0 10px rgba(34, 227, 255, 0.35);
}
.color-swatch:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.color-pop {
  display: flex;
  align-items: center;
  gap: 12px;
}
.native-color {
  width: 48px;
  height: 36px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
}
.hex-field {
  display: flex;
  align-items: center;
  gap: 2px;
  border: 1px solid var(--tc-border, rgba(120, 80, 200, 0.45));
  border-radius: 6px;
  padding: 4px 8px;
  background: rgba(0, 0, 0, 0.25);
}
.hash {
  color: var(--tc-text-dim, #a99bd6);
  font-size: 13px;
  font-weight: 700;
}
.hex-input {
  width: 72px;
  border: none;
  outline: none;
  background: transparent;
  color: var(--tc-text, #f5f7ff);
  font-size: 13px;
  font-family: "JetBrains Mono Variable", monospace;
  text-transform: uppercase;
}
.hex-input::placeholder {
  color: var(--tc-text-dim, #a99bd6);
}
</style>

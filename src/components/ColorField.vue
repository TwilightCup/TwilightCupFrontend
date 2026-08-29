<script setup lang="ts">
/**
 * 选手主题色控制：点击颜色预览方块会直接打开 Element Plus 颜色选择器，
 * HEX 输入框位于颜色选择器面板内；不展示透明度，始终按完全不透明处理。
 */
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

function onUpdate(value: string | null): void {
  if (value) emit("update:modelValue", value.toLowerCase());
}
</script>

<template>
  <el-color-picker
    :model-value="props.modelValue"
    :show-alpha="false"
    :color-format="'hex'"
    :disabled="props.disabled"
    :aria-label="props.label"
    @update:model-value="onUpdate"
  />
</template>

<style scoped>
/* 保持与面板其他控件一致的尺寸 */
:deep(.el-color-picker__trigger) {
  width: 44px;
  height: 44px;
  padding: 4px;
  border-radius: 8px;
}
</style>

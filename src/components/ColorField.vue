<script setup lang="ts">
/**
 * 选手主题色控制：点击颜色预览方块直接打开颜色选择器面板，
 * 面板内包含 HEX 输入框与 Reset / Cancel / OK 按钮；不显示透明度。
 */
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    label?: string;
    disabled?: boolean;
    defaultValue?: string;
  }>(),
  {
    label: "",
    disabled: false,
    defaultValue: "",
  },
);
const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
}>();

const { t } = useI18n();
const open = ref(false);
const draft = ref(props.modelValue);

watch(
  () => props.modelValue,
  (v) => {
    if (!open.value) draft.value = v;
  },
);
watch(open, (v) => {
  if (v) draft.value = props.modelValue;
});

function onPanelUpdate(value: string | null): void {
  if (value) draft.value = value.toLowerCase();
}

function reset(): void {
  draft.value = props.defaultValue || props.modelValue;
}

function cancel(): void {
  draft.value = props.modelValue;
  open.value = false;
}

function confirm(): void {
  emit("update:modelValue", draft.value.toLowerCase());
  open.value = false;
}
</script>

<template>
  <el-popover
    v-model:visible="open"
    trigger="click"
    placement="bottom-start"
    :width="330"
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

    <el-color-picker-panel
      :model-value="draft"
      :show-alpha="false"
      :color-format="'hex'"
      :border="false"
      :disabled="disabled"
      @update:model-value="onPanelUpdate"
    >
      <template #footer>
        <div class="color-footer">
          <el-button size="small" :disabled="disabled" @click="reset">
            {{ t("directorView.sceneCfgReset") }}
          </el-button>
          <el-button size="small" :disabled="disabled" @click="cancel">
            {{ t("directorView.sceneCfgCancel") }}
          </el-button>
          <el-button size="small" type="primary" :disabled="disabled" @click="confirm">
            {{ t("directorView.sceneCfgOk") }}
          </el-button>
        </div>
      </template>
    </el-color-picker-panel>
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

/* HEX 输入框：收窄到刚好容纳 #RRGGBB 文本 */
:deep(.el-color-picker-panel__footer .el-input) {
  width: 92px;
}
.color-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}
</style>

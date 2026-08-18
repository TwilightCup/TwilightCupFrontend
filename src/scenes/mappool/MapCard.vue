<script setup lang="ts">
/**
 * 图池单卡：方框 + 配图 + 编号/名称/类别/词条。
 *
 * 配图：优先 pick.logo_url（MinIO 公开访问 URL，桶公开读后永久有效；后端 MatchOut /
 * MappoolOut 输出层已签发）。无值则纯色底占位（按类别 CategoryKind 着色 + 大号霓虹编号）。
 * <img> 加载失败（如网络/对象缺失）回退占位。
 */
import { computed, ref } from "vue";
import { categoryKindInfo, pickTypeLabel } from "@/utils/format";
import { CT_TAG_ACHIEVEMENT, type CategoryKind, type Pick } from "@/api/types";

const props = defineProps<{ pick: Pick; kind: CategoryKind }>();

const kindInfo = computed(() => categoryKindInfo(props.kind));

const logoSrc = computed(() => props.pick.logo_url ?? null);
/** 图片加载失败（网络/对象缺失）→ 回退占位 */
const imgFailed = ref(false);
const showImage = computed(() => !!logoSrc.value && !imgFailed.value);

/** 类别 → 占位底色（与 global.css / format 的标签色系呼应） */
const bgColor = computed<string>(() => {
  switch (props.kind) {
    case "ML":
      return "#1b3a6b";
    case "IL":
      return "#1d4d36";
    case "CP":
      return "#5a3a12";
    case "CT":
      return "#5a1620";
    case "TB":
      return "#4a0f2a";
    default:
      return "#33313f";
  }
});

/** 解析附加词条（pick.tag 逗号分隔，或前端派生的 tags 数组） */
const tags = computed<string[]>(() => {
  if (props.pick.tags?.length) return props.pick.tags;
  if (!props.pick.tag) return [];
  return props.pick.tag.split(",").map((s) => s.trim()).filter(Boolean);
});
</script>

<template>
  <div class="card neon-panel">
    <div class="art" :style="{ background: showImage ? '#000' : bgColor }">
      <img
        v-if="showImage"
        :src="logoSrc!"
        :alt="pick.name"
        @error="imgFailed = true"
      />
      <div v-else class="placeholder">
        <div class="code neon-text">{{ pick.code }}</div>
      </div>
      <!-- 角标：类别 + 单/多关 -->
      <div class="badges">
        <span class="badge kind">{{ kindInfo?.short ?? kind }}</span>
        <span class="badge type">{{ pickTypeLabel(pick.type) }}</span>
      </div>
    </div>
    <div class="meta">
      <div class="name">{{ pick.name }}</div>
      <div v-if="tags.length" class="tags">
        <span v-for="tg in tags" :key="tg" class="tag" :class="{ ach: tg === CT_TAG_ACHIEVEMENT }">
          {{ tg }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.card {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 12px;
}
.art {
  position: relative;
  aspect-ratio: 4 / 3;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-bottom: 1px solid var(--syn-border);
}
.art img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}
/* 占位纹理：对角细线，呼应合成器浪潮 */
.art::before {
  content: "";
  position: absolute;
  inset: 0;
  background-image: repeating-linear-gradient(
    45deg,
    rgba(255, 255, 255, 0.04) 0 2px,
    transparent 2px 12px
  );
  pointer-events: none;
}
.code {
  font-size: clamp(26px, 3.4vw, 52px);
  font-weight: 900;
  letter-spacing: 2px;
  z-index: 1;
}
.badges {
  position: absolute;
  top: 8px;
  left: 8px;
  display: flex;
  gap: 6px;
  z-index: 2;
}
.badge {
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(10, 1, 24, 0.7);
  border: 1px solid var(--syn-border);
  color: var(--syn-text);
}
.badge.type {
  color: var(--syn-text-dim);
}
.meta {
  padding: 8px 12px 10px;
}
.name {
  font-size: clamp(13px, 1.3vw, 18px);
  font-weight: 700;
  color: var(--syn-text);
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 6px;
}
.tag {
  font-size: 10px;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(255, 46, 136, 0.16);
  border: 1px solid var(--syn-magenta);
  color: #ffb3d4;
}
.tag.ach {
  background: rgba(255, 209, 102, 0.16);
  border-color: var(--syn-win);
  color: #ffe3a3;
}
</style>

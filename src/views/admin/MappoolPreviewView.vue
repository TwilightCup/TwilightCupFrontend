<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "@/api/client";
import { PickType, type MappoolLibItem, type Pick } from "@/api/types";
import { useAuthStore } from "@/stores/auth";
import { useAdminStore } from "@/stores/admin";
import { categoryKindInfo, dateTime } from "@/utils/format";
import { pickTagTokens } from "@/utils/mappool";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const admin = useAdminStore();
const pool = ref<MappoolLibItem | null>(null);
const loading = ref(false);
const error = ref(false);
const totalPicks = computed(() => pool.value?.mappool.categories.reduce((n, c) => n + c.picks.length, 0) ?? 0);
let loadVersion = 0;

async function load(): Promise<void> {
  const version = ++loadVersion;
  loading.value = true;
  error.value = false;
  pool.value = null;
  try {
    const result = await api.getMappool(String(route.params.id), auth.token);
    if (version === loadVersion) pool.value = result;
  } catch {
    if (version === loadVersion) error.value = true;
  } finally {
    if (version === loadVersion) loading.value = false;
  }
}

function levelsOf(pick: Pick): string[] {
  const levels = pick.collection?.raw?.levels;
  return Array.isArray(levels) ? levels.map(String) : [];
}

function levelLabel(id: string): string {
  const level = admin.levelById.get(id) ?? admin.levelByName.get(id);
  return level ? level.display_name || level.name : id;
}

watch(() => route.params.id, () => { void load(); }, { immediate: true });
void admin.loadLevels();
</script>

<template>
  <div class="preview-page">
    <div class="toolbar">
      <div>
        <h2>{{ pool?.name ?? $t('admin.mappools.previewTitle') }}</h2>
        <p class="dim">{{ $t('admin.mappools.previewHint') }}</p>
      </div>
      <div class="actions">
        <el-button @click="router.push({ name: 'admin-mappools' })">{{ $t('admin.mappools.backToList') }}</el-button>
        <el-button :loading="loading" @click="load">{{ $t('common.refresh') }}</el-button>
      </div>
    </div>
    <p v-if="loading" role="status">{{ $t('common.loading') }}</p>
    <el-alert v-else-if="error" :title="$t('admin.mappools.previewLoadError')" type="error" :closable="false" show-icon />
    <template v-else-if="pool">
      <p class="dim">{{ $t('common.picksCount', { n: totalPicks }) }} · {{ $t('common.createdAt') }}: {{ dateTime(pool.created_at) }}</p>
      <el-empty v-if="pool.mappool.categories.length === 0" :description="$t('common.empty')" />
      <section v-for="(category, ci) in pool.mappool.categories" :key="ci" class="category">
        <h3>
          <el-tag :type="categoryKindInfo(category.name)?.type ?? 'info'" effect="dark">{{ category.name }}</el-tag>
          <span>{{ $t('common.picksCount', { n: category.picks.length }) }}</span>
        </h3>
        <p v-if="category.ct_tags != null" class="dim">
          {{ $t('mappoolEditor.ctTagTitle') }}: {{ category.ct_tags.join(', ') || $t('common.empty') }}
        </p>
        <p v-if="category.picks.length === 0" class="dim">{{ $t('common.empty') }}</p>
        <div class="picks">
          <article v-for="(pick, pi) in category.picks" :key="pi" class="pick">
            <img v-if="pick.logo_url" :src="pick.logo_url" :alt="pick.name" class="cover" />
            <h4><span class="code">{{ pick.code }}</span> {{ pick.name }}</h4>
            <dl>
              <dt>{{ $t('pickEditor.labelType') }}</dt>
              <dd>{{ $t(pick.type === PickType.SINGLE ? 'pickEditor.typeSingle' : 'pickEditor.typeMulti') }}</dd>
              <dt>{{ $t('admin.mappools.persistedTags') }}</dt>
              <dd>
                <el-tag v-for="tag in pickTagTokens(pick)" :key="tag" size="small">{{ tag }}</el-tag>
                <span v-if="pickTagTokens(pick).length === 0" class="dim">{{ $t('common.empty') }}</span>
              </dd>
              <template v-if="pick.retry_count != null">
                <dt>{{ $t('pickEditor.labelRetryCount') }}</dt><dd>{{ pick.retry_count }}</dd>
              </template>
              <dt>{{ $t('pickEditor.labelLevelList') }}</dt>
              <dd>
                <ol v-if="levelsOf(pick).length"><li v-for="(level, li) in levelsOf(pick)" :key="li">{{ levelLabel(level) }}</li></ol>
                <span v-else class="dim">{{ $t('common.empty') }}</span>
              </dd>
            </dl>
          </article>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.preview-page { display: flex; flex-direction: column; gap: 16px; }
.toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
h2, h3, h4, p { margin: 0; }
h2 { font-size: 20px; }
.toolbar p { margin-top: 6px; }
.dim { color: var(--tc-text-dim); font-size: 13px; }
.actions, h3 { display: flex; align-items: center; gap: 8px; }
h3 { font-size: 14px; margin-bottom: 12px; }
.category > p { margin-bottom: 12px; }
.picks { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: 12px; }
.pick { border: 1px solid var(--el-border-color); background: var(--el-bg-color); border-radius: 8px; padding: 16px; min-width: 0; overflow-wrap: anywhere; }
h4 { font-size: 16px; margin-bottom: 12px; }
.code { color: var(--el-color-primary); margin-right: 8px; }
dl { display: grid; grid-template-columns: auto 1fr; gap: 10px 16px; font-size: 13px; margin: 0; }
dt { color: var(--tc-text-dim); }
dd { margin: 0; }
dd .el-tag { margin: 0 4px 4px 0; }
ol { padding-left: 20px; margin: 0; }
.cover { width: 100%; max-height: 160px; object-fit: cover; border-radius: 4px; margin-bottom: 12px; }
</style>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { useI18n } from "vue-i18n";
import { api, ApiError } from "@/api/client";
import { useAuthStore } from "@/stores/auth";
import { MatchStatus, type MatchSummary } from "@/api/types";
import { dateTime, matchStatusInfo } from "@/utils/format";

const { t } = useI18n();

/**
 * 导播「我的比赛」列表（多场切换入口）。
 * 列出导播参与的比赛；每项可进入控制台 / 复制带 session 的 OBS 叠加层链接。
 * 多场 = 多开浏览器标签（每标签一场，各自 WS），与裁判一致。
 */
const auth = useAuthStore();
const router = useRouter();

const matches = ref<MatchSummary[]>([]);
const loading = ref(false);

async function load(): Promise<void> {
  if (!auth.token) return;
  loading.value = true;
  try {
    matches.value = await api.listMyMatches(auth.token);
  } catch (e) {
    ElMessage.error(e instanceof ApiError ? e.message : t("director.loadError"));
  } finally {
    loading.value = false;
  }
}

function go(s: MatchSummary): void {
  void router.push(`/director/${s.id}`);
}

function logout(): void {
  auth.logout();
  router.replace("/login");
}

onMounted(() => {
  load();
});
</script>

<template>
  <div class="home">
    <header class="head">
      <div class="brand">
        <span class="logo">🌇</span>
        <div>
          <div class="title">{{ $t("director.title") }}</div>
          <div class="subtitle">{{ $t("director.subtitle") }}</div>
        </div>
      </div>
      <div class="actions">
        <el-button :loading="loading" @click="load">{{ $t("common.refresh") }}</el-button>
        <el-button type="danger" plain @click="logout">{{ $t("common.logout") }}</el-button>
      </div>
    </header>

    <div v-loading="loading" class="list">
      <div v-if="!loading && matches.length === 0" class="empty">
        {{ $t("director.empty") }}
      </div>

      <div
        v-for="s in matches"
        :key="s.id"
        class="card"
        :class="{ ended: s.status === MatchStatus.ENDED }"
      >
        <div class="card-main">
          <div class="row1">
            <span class="name">{{ s.name }}</span>
            <el-tag :type="matchStatusInfo(s.status).type" effect="dark" size="small">
              {{ matchStatusInfo(s.status).label }}
            </el-tag>
          </div>
          <div class="meta">
            <span>{{ $t("director.matchMeta", { bo: s.bo_format, win: s.win_threshold }) }}</span>
            <span class="vs">
              <span class="tc-a">{{ s.player_a_name }}</span>
              <span class="dim"> vs </span>
              <span class="tc-b">{{ s.player_b_name }}</span>
            </span>
            <span class="dim">{{ dateTime(s.created_at) }}</span>
          </div>
        </div>
        <div class="card-op">
          <router-link :to="`/director/${s.id}`" class="enter" @click.prevent="go(s)">
            {{ $t("director.enterConsole") }}
          </router-link>
          <div class="hint">{{ $t("common.cmdClickHint") }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.home {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--tc-bg);
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: var(--tc-bg-soft);
  border-bottom: 1px solid var(--tc-border);
}
.brand {
  display: flex;
  align-items: center;
  gap: 12px;
}
.logo {
  font-size: 26px;
}
.title {
  font-size: 16px;
  font-weight: 600;
}
.subtitle {
  font-size: 12px;
  color: var(--tc-text-dim);
}
.actions {
  display: flex;
  gap: 8px;
}
.list {
  flex: 1;
  overflow: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.empty {
  color: var(--tc-text-dim);
  text-align: center;
  padding: 48px;
  font-size: 14px;
}
.card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: var(--tc-bg-soft);
  border: 1px solid var(--tc-border);
  border-radius: 10px;
  padding: 14px 16px;
}
.card.ended {
  opacity: 0.6;
}
.card-main {
  min-width: 0;
}
.row1 {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}
.name {
  font-size: 15px;
  font-weight: 600;
}
.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  font-size: 13px;
}
.vs {
  font-weight: 600;
}
.tc-a {
  color: var(--tc-a);
}
.tc-b {
  color: var(--tc-b);
}
.dim {
  color: var(--tc-text-dim);
  font-size: 12px;
}
.card-op {
  text-align: right;
  flex-shrink: 0;
}
.enter {
  display: inline-block;
  padding: 6px 14px;
  border-radius: 8px;
  background: var(--tc-primary);
  color: var(--tc-bg);
  font-weight: 600;
  font-size: 13px;
  text-decoration: none;
}
.enter:hover {
  filter: brightness(1.1);
}
.hint {
  margin-top: 4px;
  font-size: 11px;
  color: var(--tc-text-dim);
}
</style>

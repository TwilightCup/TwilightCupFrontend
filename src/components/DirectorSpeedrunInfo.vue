<script setup lang="ts">
import { computed, watch } from "vue";
import { useAuthStore } from "@/stores/auth";
import { useDirectorStore } from "@/stores/director";
import { setSpeedrunToken } from "@/api/speedrun";
import { useCategoryInfo, type CategoryInfoStatus } from "@/scenes/categoryinfo/useCategoryInfo";
import { formatRunTime } from "@/utils/format";

const auth = useAuthStore();
const director = useDirectorStore();
// Set credentials before the hook's immediate binding lookups.
watch(() => auth.token, token => setSpeedrunToken(token || null), { immediate: true });
const { status, rows, boardDisplay, pbA, pbB, refreshedAt, errDetail } = useCategoryInfo(
  computed(() => auth.token ? director.currentRound : null),
  computed(() => auth.token ? director.speedrunA : null),
  computed(() => auth.token ? director.speedrunB : null),
);
const title = computed(() => status.value === "ok" && boardDisplay.value
  ? [boardDisplay.value.levelName, boardDisplay.value.categoryName, ...boardDisplay.value.valueLabels].filter(Boolean).join(" · ")
  : director.currentRound?.pick.name || director.currentRound?.pick.code || "等待选图");
const messages: Record<CategoryInfoStatus, string> = {
  idle: "等待裁判宣布选图", loading: "正在拉取 speedrun 信息…", ok: "",
  noMapping: "当前项目未匹配到 speedrun 榜单", error: "speedrun 信息拉取失败",
  rateLimit: "speedrun 请求被限流，请稍后使用顶部刷新按钮重试",
};
const updated = computed(() => refreshedAt.value ? new Date(refreshedAt.value).toLocaleString() : "");
const players = computed(() => (["A", "B"] as const).map(side => ({
  side, name: side === "A" ? director.nameA : director.nameB,
  binding: side === "A" ? director.speedrunA : director.speedrunB,
  pb: side === "A" ? pbA.value : pbB.value,
})));
</script>

<template>
  <section class="speedrun-info" aria-label="speedrun 信息">
    <strong class="project">{{ title }}</strong>
    <template v-if="status === 'ok'">
      <div class="personal-bests">
        <div v-for="player in players" :key="player.side" class="pb">
          <span>{{ player.side }} · {{ player.name || player.binding || '未绑定选手' }}</span>
          <b>{{ !player.binding ? '未绑定 speedrun' : player.pb === undefined ? 'PB 待获取' : player.pb === null ? '暂无 PB' : formatRunTime(player.pb.timeSec) }}</b>
          <small v-if="player.pb">#{{ player.pb.place }}</small>
        </div>
      </div>
      <div v-if="rows.length" class="board">
        <table>
          <thead><tr><th>排名</th><th>选手</th><th>成绩</th></tr></thead>
          <tbody>
            <tr v-for="(row, index) in rows" :key="index" :class="row.highlight">
              <td>{{ row.place }}</td>
              <td>{{ row.playerName }}<b v-if="row.highlight"> · {{ row.highlight }}</b></td>
              <td>{{ formatRunTime(row.timeSec) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else>当前榜单暂无成绩</p>
      <small v-if="updated">数据更新时间：{{ updated }}</small>
    </template>
    <template v-else>
      <p role="status">{{ messages[status] }}</p>
      <small v-if="status === 'error' || status === 'rateLimit'">{{ errDetail }}</small>
    </template>
  </section>
</template>

<style scoped>
.speedrun-info { font-size: 12px; color: var(--tc-text-dim); }
.project { display: block; color: var(--tc-text); overflow-wrap: anywhere; margin-bottom: 10px; }
.personal-bests { display: grid; gap: 6px; margin-bottom: 10px; }
.pb { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.pb span { flex: 1; overflow-wrap: anywhere; }
.pb b { color: var(--tc-text); }
.board { max-height: 260px; overflow: auto; margin-bottom: 8px; }
table { border-collapse: collapse; width: 100%; }
th, td { padding: 5px 4px; text-align: left; border-bottom: 1px solid var(--tc-border); }
td:nth-child(2) { overflow-wrap: anywhere; }
th:last-child, td:last-child { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
tr.A { color: #3d8bff; }
tr.B { color: #ff6b4a; }
small { overflow-wrap: anywhere; }
</style>

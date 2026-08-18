<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useAdminStore } from "@/stores/admin";
import { useAuthStore } from "@/stores/auth";
import { api, ApiError } from "@/api/client";
import type {
  ChatMessage,
  MatchLog,
  RoundRecord,
  MatchOut,
} from "@/api/types";
import { ChatSenderRole } from "@/api/types";
import {
  dateTime,
  formatMs,
  pickTypeLabel,
  roundSourceLabel,
  scoringMethodLabel,
  matchStatusInfo,
  shortTime,
  verdictInfo,
} from "@/utils/format";

const props = defineProps<{
  modelValue: boolean;
  match: MatchOut | null;
}>();
const emit = defineEmits<{ (e: "update:modelValue", v: boolean): void }>();

const { t } = useI18n();
const admin = useAdminStore();
const auth = useAuthStore();

const activeTab = ref("overview");
const loading = ref(false);
const matchLog = ref<MatchLog | null>(null);
const rounds = ref<RoundRecord[]>([]);
const chat = ref<ChatMessage[]>([]);
const dataError = ref("");

function pickCount(s: MatchOut | null): number {
  if (!s) return 0;
  return s.mappool.categories.reduce((n, c) => n + c.picks.length, 0);
}

/**
 * 聊天发送者身份 → 名字着色类：
 * - 系统：灰色（默认）
 * - 选手：按 A/B 座席（比对 sender_id 与比赛 player_a_id/player_b_id）
 * - 裁判：黄色
 * - 其余（导播等）：灰色兜底
 */
function senderKind(m: ChatMessage): string {
  if (m.is_system || m.sender_role === ChatSenderRole.SYSTEM) return "sys";
  const id = m.sender_id ?? "";
  if (id && props.match) {
    if (id === props.match.player_a_id) return "pa";
    if (id === props.match.player_b_id) return "pb";
  }
  if (m.sender_role === ChatSenderRole.REFEREE) return "ref";
  return "sys";
}

/** 选图编号 → 可读标签（code · name）；图池里找不到时只显示 code。 */
function codeLabel(code: string): string {
  if (!props.match) return code;
  const p = props.match.mappool.categories
    .flatMap((c) => c.picks)
    .find((pk) => pk.code === code);
  return p ? `${p.code}${p.name ? " · " + p.name : ""}` : code;
}

/**
 * 本场 ban/pick/protect 摘要（来自后端 draft_snapshot；后端未持久化时为空，
 * 该回合卡片不显示该区）。ban/protect/CT 词条禁用整场一次。
 */
const draftSummary = computed(() => {
  const snap = matchLog.value?.draft_snapshot;
  const bans: { label: string; by: "A" | "B" }[] = [];
  const protects: { label: string; by: "A" | "B" }[] = [];
  for (const a of snap?.actions ?? []) {
    const item = { label: codeLabel(a.code), by: a.by };
    if (a.kind === "ban") bans.push(item);
    else protects.push(item);
  }
  const tagBans: { tag: string; by: "A" | "B" }[] = [];
  (["A", "B"] as const).forEach((side) => {
    const tag = snap?.tagBanBy?.[side];
    if (tag) tagBans.push({ tag, by: side });
  });
  return { bans, protects, tagBans, present: !!snap };
});

/** 本回合选图归属方（跨回合累积 picks 列表）。 */
function pickerOf(code: string): "A" | "B" | null {
  const snap = matchLog.value?.draft_snapshot;
  const p = snap?.picks?.find((pk) => pk.code === code);
  return p ? p.by : null;
}

async function loadData(): Promise<void> {
  matchLog.value = null;
  rounds.value = [];
  chat.value = [];
  dataError.value = "";
  if (!props.match) return;
  const sid = props.match.id;
  const token = auth.token;
  loading.value = true;
  try {
    const log = await api.getMatchLog(sid, token);
    matchLog.value = log;
    const n = log.round_ids.length;
    if (n > 0) {
      const results = await Promise.allSettled(
        Array.from({ length: n }, (_, i) => api.getRoundDetail(sid, i + 1, token)),
      );
      rounds.value = results
        .map((r) => (r.status === "fulfilled" ? r.value : null))
        .filter((r): r is RoundRecord => !!r)
        .sort((a, b) => a.round_no - b.round_no);
    }
  } catch (e) {
    if (!(e instanceof ApiError && e.code === 404)) {
      dataError.value = t("matchDetail.loadFailed");
    }
    // 404 = 比赛日志尚未生成（首回合未开始），静默
  }
  try {
    chat.value = await api.getChatLog(sid, token);
  } catch {
    chat.value = [];
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open && props.match) {
      activeTab.value = "overview";
      loadData();
    }
  },
);
</script>

<template>
  <el-drawer
    :model-value="modelValue"
    :title="$t('matchDetail.title')"
    direction="rtl"
    size="600px"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template v-if="match">
      <el-tabs v-model="activeTab" class="tabs">
        <!-- 概览 -->
        <el-tab-pane :label="$t('matchDetail.tabOverview')" name="overview">
          <el-descriptions :column="2" border size="small" class="desc">
            <el-descriptions-item :label="$t('matchDetail.descName')" :span="2">
              {{ match.name }}
            </el-descriptions-item>
            <el-descriptions-item :label="$t('matchDetail.descStatus')">
              <el-tag :type="matchStatusInfo(match.status).type" effect="dark" size="small">
                {{ matchStatusInfo(match.status).label }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item :label="$t('matchDetail.descFormat')">
              {{ $t('matchDetail.formatValue', { bo: match.bo_format, win: match.win_threshold }) }}
            </el-descriptions-item>
            <el-descriptions-item :label="$t('matchDetail.descScoringMethod')">
              {{ scoringMethodLabel(match.scoring_method) }}
            </el-descriptions-item>
            <el-descriptions-item :label="$t('matchDetail.descStartDelay')">
              {{ $t('matchDetail.delayValue', { delay: match.start_countdown_delay }) }}
            </el-descriptions-item>
            <el-descriptions-item :label="$t('matchDetail.descPlayerA')">
              <span class="tc-a">{{ admin.displayName(match.player_a_id) }}</span>
            </el-descriptions-item>
            <el-descriptions-item :label="$t('matchDetail.descPlayerB')">
              <span class="tc-b">{{ admin.displayName(match.player_b_id) }}</span>
            </el-descriptions-item>
            <el-descriptions-item :label="$t('matchDetail.descReferee')">
              {{ admin.displayName(match.referee_id) }}
            </el-descriptions-item>
            <el-descriptions-item :label="$t('matchDetail.descDirector')">
              {{ admin.displayName(match.director_id) }}
            </el-descriptions-item>
            <el-descriptions-item :label="$t('matchDetail.descCreatedAt')">
              {{ dateTime(match.created_at) }}
            </el-descriptions-item>
            <el-descriptions-item :label="$t('matchDetail.descTimeRange')">
              {{ dateTime(match.started_at) }} / {{ dateTime(match.ended_at) }}
            </el-descriptions-item>
            <el-descriptions-item v-if="match.winner" :label="$t('matchDetail.descWinner')" :span="2">
              {{ $t('matchDetail.winnerValue', { winner: match.winner }) }}
            </el-descriptions-item>
          </el-descriptions>

          <div class="section-title">
            {{ $t('matchDetail.sectionMappool', { cats: match.mappool.categories.length, picks: pickCount(match) }) }}
          </div>
          <div class="mappool-overview">
            <div
              v-for="cat in match.mappool.categories"
              :key="cat.name"
              class="cat-block"
            >
              <div class="cat-name">{{ cat.name }}</div>
              <div class="pick-chips">
                <el-tag
                  v-for="p in cat.picks"
                  :key="p.code"
                  size="small"
                  effect="plain"
                >
                  {{ p.code }}
                  <span class="pick-name" v-if="p.name">· {{ p.name }}</span>
                </el-tag>
              </div>
            </div>
          </div>

          <div v-if="matchLog?.final_result" class="final-result">
            <div class="section-title">{{ $t('matchDetail.sectionResult') }}</div>
            <div class="score-line">
              <span class="tc-a">A {{ matchLog.final_result.wins_a ?? 0 }}</span>
              <span class="sep">:</span>
              <span class="tc-b">{{ matchLog.final_result.wins_b ?? 0 }} B</span>
              <el-tag
                v-if="matchLog.final_result.winner"
                type="success"
                effect="dark"
                size="small"
                class="winner-tag"
              >
                {{ $t('matchDetail.resultWinnerLabel', { winner: matchLog.final_result.winner }) }}
              </el-tag>
            </div>
          </div>
        </el-tab-pane>

        <!-- 回合数据 -->
        <el-tab-pane :label="$t('matchDetail.tabRounds', { n: rounds.length ? ` (${rounds.length})` : '' })" name="rounds">
          <div v-loading="loading">
            <div v-if="dataError" class="empty">{{ dataError }}</div>
            <div v-else-if="!matchLog" class="empty">
              {{ $t('matchDetail.noLogYet') }}
            </div>
            <template v-else>
              <!-- ban/pick/protect 阶段（整场一次，独立于回合数据之前展示；后端未持久化时不显示） -->
              <div
                v-if="draftSummary.bans.length || draftSummary.protects.length || draftSummary.tagBans.length"
                class="draft-stage"
              >
                <div class="ds-title">{{ $t('matchDetail.draftStageTitle') }}</div>
                <div v-if="draftSummary.bans.length" class="ds-row">
                  <span class="ds-label ban">{{ $t('matchDetail.draftBans') }}</span>
                  <el-tag
                    v-for="(c, i) in draftSummary.bans"
                    :key="`ban-${i}`"
                    size="small"
                    effect="dark"
                    :class="`by-${c.by}`"
                  >{{ c.label }} · {{ c.by }}</el-tag>
                </div>
                <div v-if="draftSummary.protects.length" class="ds-row">
                  <span class="ds-label protect">{{ $t('matchDetail.draftProtects') }}</span>
                  <el-tag
                    v-for="(c, i) in draftSummary.protects"
                    :key="`prot-${i}`"
                    size="small"
                    effect="dark"
                    :class="`by-${c.by}`"
                  >{{ c.label }} · {{ c.by }}</el-tag>
                </div>
                <div v-if="draftSummary.tagBans.length" class="ds-row">
                  <span class="ds-label tagban">{{ $t('matchDetail.draftTagBans') }}</span>
                  <el-tag
                    v-for="(tb, i) in draftSummary.tagBans"
                    :key="`tagban-${i}`"
                    size="small"
                    effect="dark"
                    :class="`by-${tb.by}`"
                  >{{ tb.tag }} · {{ tb.by }}</el-tag>
                </div>
              </div>

              <div v-if="rounds.length === 0" class="empty">{{ $t('matchDetail.noRounds') }}</div>
              <div v-else class="round-list">
                <div v-for="r in rounds" :key="r.id" class="round-card">
                  <div class="rc-head">
                    <span class="rc-no">#{{ r.round_no }}</span>
                    <b>{{ r.pick_snapshot.code }}</b>
                    <span v-if="r.pick_snapshot.name" class="rc-name">
                      · {{ r.pick_snapshot.name }}
                    </span>
                    <el-tag
                      v-if="pickerOf(r.pick_snapshot.code)"
                      size="small"
                      effect="dark"
                      :class="`pick-by by-${pickerOf(r.pick_snapshot.code)}`"
                    >
                      {{ $t('matchDetail.pickedBy', { side: pickerOf(r.pick_snapshot.code) }) }}
                    </el-tag>
                    <el-tag size="small" effect="plain">
                      {{ pickTypeLabel(r.pick_snapshot.type) }}
                    </el-tag>
                    <el-tag
                      size="small"
                      :type="r.source === 2 ? ('warning' as const) : ('info' as const)"
                      effect="plain"
                    >
                      {{ roundSourceLabel(r.source) }}
                    </el-tag>
                    <el-tag v-if="!r.counted" size="small" type="info" effect="dark">
                      {{ $t('matchDetail.notCounted') }}
                    </el-tag>
                  </div>

                  <div class="rc-score">
                    <div class="side tc-a">
                      <span class="lab">A</span>
                      <span class="val">{{ formatMs(r.score_a_ms ?? null) }}</span>
                    </div>
                    <div class="side tc-b">
                      <span class="lab">B</span>
                      <span class="val">{{ formatMs(r.score_b_ms ?? null) }}</span>
                    </div>
                    <el-tag
                      v-if="r.verdict != null"
                      :type="verdictInfo(r.verdict).type"
                      effect="dark"
                      size="small"
                    >
                      {{ verdictInfo(r.verdict).label }}
                    </el-tag>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </el-tab-pane>

        <!-- 聊天 -->
        <el-tab-pane :label="$t('matchDetail.tabChat', { n: chat.length ? ` (${chat.length})` : '' })" name="chat">
          <div v-if="chat.length === 0" class="empty">{{ $t('matchDetail.noChat') }}</div>
          <div v-else class="chat-list">
            <div
              v-for="m in chat"
              :key="m.id"
              class="chat-line"
              :class="{ sys: m.is_system }"
            >
              <span class="cl-time">{{ shortTime(m.ts) }}</span>
              <span class="cl-name" :class="`cl-${senderKind(m)}`">
                {{ m.sender_name }}
              </span>
              <span class="cl-text">{{ m.text }}</span>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </template>
  </el-drawer>
</template>

<style scoped>
.tabs {
  height: 100%;
  display: flex;
  flex-direction: column;
}
/* tab 内容区可滚动：聊天/回合记录多时不撑破抽屉 */
.tabs :deep(.el-tabs__content) {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.desc {
  margin-bottom: 16px;
}
.section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--tc-text-dim);
  margin: 16px 0 8px;
  letter-spacing: 0.5px;
}
.mappool-overview {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.cat-block {
  background: var(--tc-bg-soft);
  border: 1px solid var(--tc-border);
  border-radius: 8px;
  padding: 8px 10px;
}
.cat-name {
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 6px;
}
.pick-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.pick-name {
  color: var(--tc-text-dim);
}
.final-result {
  margin-top: 8px;
}
.score-line {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 18px;
  font-weight: 700;
}
.score-line .sep {
  color: var(--tc-text-dim);
}
.winner-tag {
  margin-left: 8px;
}
.empty {
  color: var(--tc-text-dim);
  text-align: center;
  padding: 30px 12px;
  font-size: 13px;
}
.round-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.round-card {
  background: var(--tc-bg-soft);
  border: 1px solid var(--tc-border);
  border-radius: 10px;
  padding: 10px 12px;
}
.rc-head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 13px;
  margin-bottom: 6px;
}
.rc-no {
  color: var(--tc-text-dim);
}
.rc-name {
  color: var(--tc-text-dim);
}
/* 本回合 pick 归属方徽标配色（A 蓝 / B 橙） */
.pick-by.by-A {
  --el-tag-bg-color: var(--tc-a);
  --el-tag-border-color: var(--tc-a);
  --el-tag-text-color: #fff;
  color: #fff;
}
.pick-by.by-B {
  --el-tag-bg-color: var(--tc-b);
  --el-tag-border-color: var(--tc-b);
  --el-tag-text-color: #fff;
  color: #fff;
}
/* ban/pick/protect 阶段卡（独立于回合数据之前展示，复用 round-card 外观） */
.draft-stage {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;
  padding: 10px 12px;
  background: var(--tc-bg-soft);
  border: 1px solid var(--tc-border);
  border-radius: 10px;
  font-size: 12px;
}
.ds-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--tc-text);
  letter-spacing: 0.3px;
}
.ds-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}
.ds-label {
  font-weight: 600;
  margin-right: 2px;
  flex-shrink: 0;
}
.ds-label.ban {
  color: var(--tc-b);
}
.ds-label.protect {
  color: var(--tc-a);
}
.ds-label.tagban {
  color: var(--tc-text-dim);
}
/* ban/protect/tagban chip 按执行方着色 */
.draft-stage .by-A {
  --el-tag-bg-color: var(--tc-a);
  --el-tag-border-color: var(--tc-a);
  --el-tag-text-color: #fff;
  color: #fff;
}
.draft-stage .by-B {
  --el-tag-bg-color: var(--tc-b);
  --el-tag-border-color: var(--tc-b);
  --el-tag-text-color: #fff;
  color: #fff;
}
.rc-score {
  display: flex;
  align-items: center;
  gap: 16px;
  padding-top: 6px;
  border-top: 1px dashed var(--tc-border);
}
.rc-score .side {
  display: flex;
  align-items: baseline;
  gap: 6px;
}
.rc-score .lab {
  font-size: 12px;
  color: var(--tc-text-dim);
}
.rc-score .val {
  font-size: 18px;
  font-weight: 700;
}
.chat-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.chat-line {
  display: flex;
  gap: 8px;
  font-size: 13px;
  align-items: baseline;
}
.chat-line.sys {
  color: var(--tc-text-dim);
}
.cl-time {
  color: var(--tc-text-dim);
  font-size: 11px;
  flex-shrink: 0;
  width: 64px;
  font-family: "SFMono-Regular", "Menlo", "Consolas", "Liberation Mono", monospace;
}
.cl-name {
  font-weight: 600;
  flex-shrink: 0;
  width: 96px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
}
/* 名字按身份着色：系统灰、A 蓝座席、B 橙座席、裁判黄 */
.cl-sys {
  color: var(--tc-text-dim);
}
.cl-pa {
  color: var(--tc-a);
}
.cl-pb {
  color: var(--tc-b);
}
.cl-ref {
  color: #f0a020;
}
.cl-text {
  word-break: break-word;
}
</style>

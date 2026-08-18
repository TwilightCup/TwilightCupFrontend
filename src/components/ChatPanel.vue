<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { useMatchStore } from "@/stores/match";
import { shortTime } from "@/utils/format";
import type { ChatLine } from "@/stores/match";

const match = useMatchStore();
const listEl = ref<HTMLElement | null>(null);

/**
 * 名字着色类（与管理端比赛详情-聊天保持一致）：
 * - 系统 / 导播等：灰色（sys 兜底）
 * - 选手 A：蓝座席、选手 B：橙座席、裁判：黄色
 */
function senderKind(line: ChatLine): string {
  if (line.kind === "system") return "sys";
  switch (line.seat) {
    case "PLAYER_A":
      return "pa";
    case "PLAYER_B":
      return "pb";
    case "REFEREE":
      return "ref";
    default:
      return "sys";
  }
}

function send(): void {
  match.sendChat(match.chatInput);
}

function roll(): void {
  match.runCommand("!roll");
}

watch(
  () => match.messages.length,
  async () => {
    await nextTick();
    if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight;
  },
);
</script>

<template>
  <section class="chat">
    <div class="chat-head">
      <span>{{ $t('chat.title') }}</span>
    </div>
    <div ref="listEl" class="msg-list">
      <div v-if="match.messages.length === 0" class="empty">{{ $t('chat.empty') }}</div>
      <div
        v-for="line in match.messages"
        :key="line.id"
        class="chat-line"
        :class="{ sys: line.kind === 'system' }"
      >
        <span class="cl-time">{{ shortTime(line.ts) }}</span>
        <span class="cl-name" :class="`cl-${senderKind(line)}`">{{ line.senderName }}</span>
        <span class="cl-text">{{ line.text }}</span>
      </div>
    </div>
    <div class="composer">
      <el-input
        v-model="match.chatInput"
        :placeholder="$t('chat.placeholder')"
        @keyup.enter="send"
      />
      <el-button type="primary" @click="send">{{ $t('chat.sendBtn') }}</el-button>
      <el-button :title="$t('chat.rollTooltip')" @click="roll">🎲 !roll</el-button>
    </div>
  </section>
</template>

<style scoped>
.chat {
  display: flex;
  flex-direction: column;
  background: var(--tc-bg-soft);
  border: 1px solid var(--tc-border);
  border-radius: 10px;
  overflow: hidden;
  min-height: 0;
}
.chat-head {
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 600;
  color: var(--tc-text-dim);
  border-bottom: 1px solid var(--tc-border);
}
.msg-list {
  flex: 1;
  overflow-y: auto;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.empty {
  color: var(--tc-text-dim);
  text-align: center;
  margin-top: 30px;
  font-size: 13px;
}
/* 单行日志样式（与管理端比赛详情-聊天一致） */
.chat-line {
  display: flex;
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
  /* 等宽字体 + 固定列宽：时间戳右端固定，姓名/消息列起始点稳定对齐 */
  width: 56px;
  font-family: "SFMono-Regular", "Menlo", "Consolas", "Liberation Mono", monospace;
}
.cl-name {
  font-weight: 600;
  flex-shrink: 0;
  /* 固定列宽 + 右对齐：名字右端固定，消息列起始点（左边）对齐，与姓名宽度无关 */
  width: 96px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
  /* 与时间戳之间留更小间隙 */
  margin-left: 2px;
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
  white-space: pre-wrap;
  /* 与姓名之间保持可读间距 */
  margin-left: 8px;
}
.composer {
  display: flex;
  gap: 6px;
  padding: 10px;
  border-top: 1px solid var(--tc-border);
}
</style>

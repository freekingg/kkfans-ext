import type { ChatMessage, ConversationRecord } from '../core/types';

/** UI-only bounds; the server independently derives its dates from persisted messages. */
export function conversationMessageTimes(messages: ChatMessage[], historyStart?: ConversationRecord['historyStart']) {
  const real = messages.filter((m) => m.kind !== 'system' && m.direction !== 'unknown');
  let firstMessageAt: number | null = null;
  let lastMessageAt: number | null = null;
  for (const message of real) {
    if (message.timestampMs === null || !Number.isFinite(message.timestampMs)) continue;
    firstMessageAt = firstMessageAt === null ? message.timestampMs : Math.min(firstMessageAt, message.timestampMs);
    lastMessageAt = lastMessageAt === null ? message.timestampMs : Math.max(lastMessageAt, message.timestampMs);
  }
  const hasHistoryStart = Boolean(historyStart && firstMessageAt !== null &&
    !real.some((m) => m.timestampMs === null || !Number.isFinite(m.timestampMs)) &&
    real.some((m) => m.id === historyStart.messageId && m.timestampMs === firstMessageAt));
  return { firstMessageAt, lastMessageAt, hasHistoryStart };
}

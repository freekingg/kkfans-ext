import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../core/types';
import { conversationMessageTimes } from './message-times';

const message = (id: string, timestampMs: number | null, patch: Partial<ChatMessage> = {}): ChatMessage => ({
  id, key: `chat:${id}`, conversationId: 'chat', direction: 'incoming', kind: 'text', text: '',
  quotedText: null, sender: null, timestampRaw: null, timestampMs, urls: [], mediaCount: 0,
  capturedAt: 999999, domOrder: 0, ...patch,
});
describe('Local message-date presentation', () => {
  it('uses only real message dates and not capture times, including media', () => {
    expect(conversationMessageTimes([
      message('system', 1, { kind: 'system' }), message('image', 20, { kind: 'image' }),
      message('latest', 30, { direction: 'outgoing' }), message('unknown', 99, { direction: 'unknown' }),
    ])).toEqual({ firstMessageAt: 20, lastMessageAt: 30, hasHistoryStart: false });
    expect(conversationMessageTimes([message('undated', null)])).toMatchObject({ firstMessageAt: null, lastMessageAt: null });
  });
  it('older/undated messages invalidate a later claimed start', () => {
    const start = { messageId: 'first', detectedAt: 100 };
    expect(conversationMessageTimes([message('first', 20)], start).hasHistoryStart).toBe(true);
    expect(conversationMessageTimes([message('first', 20), message('earlier', 10)], start).hasHistoryStart).toBe(false);
    expect(conversationMessageTimes([message('first', 20), message('undated', null)], start).hasHistoryStart).toBe(false);
  });
});

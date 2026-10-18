import { beforeEach, describe, expect, it, vi } from 'vitest';

const { store } = vi.hoisted(() => ({ store: {} as Record<string, unknown> }));

vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(list.map((key) => [key, store[key]]));
        }),
        set: vi.fn(async (values: Record<string, unknown>) => Object.assign(store, values)),
      },
    },
  },
}));

import { mergeAiChatSessionAliases } from './ai-chat-store';
import { mergeConversationStorageAliases } from './settings';

describe('conversation alias storage migration', () => {
  beforeEach(() => {
    Object.keys(store).forEach((key) => delete store[key]);
  });

  it('moves tags, latest profile/note, SOP data and AI turns to the stable ID', async () => {
    store.conversationTags = { old_a: ['paid'], old_b: ['video-published'] };
    store.conversationNotes = {
      old_a: { text: '旧备注', updatedAt: 10 },
      old_b: { text: '新备注', updatedAt: 20 },
    };
    store.cooperationProfiles = {
      old_a: { contactWhatsapp: '+52 155 4720 5007', finalPrice: '300', updatedAt: 10 },
      old_b: { contactWhatsapp: '+52 155 4720 5007', finalPrice: '400', updatedAt: 20 },
    };
    store.conversationSopStages = {
      old_a: { stageId: '05', source: 'manual', confidence: null, confirmedAt: 10, updatedAt: 10, sopKnowledgeVersion: null },
      old_b: { stageId: '06', source: 'manual', confidence: null, confirmedAt: 20, updatedAt: 20, sopKnowledgeVersion: null },
    };
    store.conversationSopStageHistory = [{
      eventId: 'event-1', conversationId: 'old_a', fromStageId: null,
      toStageId: '05', source: 'manual', confidence: null,
      sopKnowledgeVersion: null, changedAt: 10,
    }];
    store.aiChatSessions = {
      old_a: [{ id: 'turn-1', role: 'user', content: '问题', createdAt: '2026-08-30T00:00:00Z' }],
      old_b: [{ id: 'turn-2', role: 'assistant', content: '回答', createdAt: '2026-08-30T00:00:01Z' }],
    };

    await mergeConversationStorageAliases({
      id: 'stable', title: '+52 155 4720 5007', avatarKey: null,
    }, ['old_a']);
    await mergeAiChatSessionAliases('stable', ['old_a', 'old_b']);

    expect((store.conversationTags as Record<string, string[]>).stable)
      .toEqual(['paid', 'video-published']);
    expect((store.conversationNotes as Record<string, { text: string }>).stable!.text)
      .toBe('新备注');
    expect((store.cooperationProfiles as Record<string, { finalPrice: string }>).stable!.finalPrice)
      .toBe('400');
    expect((store.conversationSopStages as Record<string, { stageId: string }>).stable!.stageId)
      .toBe('06');
    expect(store.conversationSopStageHistory).toEqual([
      expect.objectContaining({ conversationId: 'stable', eventId: 'event-1' }),
    ]);
    expect((store.aiChatSessions as Record<string, unknown[]>).stable).toHaveLength(2);
    expect((store.conversationTags as Record<string, unknown>).old_a).toBeUndefined();
    expect((store.aiChatSessions as Record<string, unknown>).old_b).toBeUndefined();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { store } = vi.hoisted(() => ({ store: {} as Record<string, unknown> }));

vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: store[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => Object.assign(store, values)),
      },
    },
  },
}));

import { getConversationNotes, saveConversationNote } from './settings';

describe('conversation notes', () => {
  beforeEach(() => {
    Object.keys(store).forEach((key) => delete store[key]);
  });

  it('saves a normalized note for one conversation', async () => {
    const note = await saveConversationNote('chat_1', '  第一行\r\n第二行  ');

    expect(note).toMatchObject({ text: '第一行\n第二行' });
    expect(await getConversationNotes()).toEqual({ chat_1: note });
  });

  it('removes an empty note without touching other conversations', async () => {
    await saveConversationNote('chat_1', 'one');
    await saveConversationNote('chat_2', 'two');
    await saveConversationNote('chat_1', '   ');

    expect(await getConversationNotes()).toMatchObject({ chat_2: { text: 'two' } });
    expect((await getConversationNotes()).chat_1).toBeUndefined();
  });

  it('rejects notes over 2000 characters', async () => {
    await expect(saveConversationNote('chat_1', 'a'.repeat(2001))).rejects.toThrow(
      '会话备注不能超过 2000 个字符',
    );
  });
});

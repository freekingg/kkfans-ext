import { describe, expect, it } from 'vitest';
import type { ChatMessage, ConversationIdentity } from '../core/types';
import {
  clearConversationMessages,
  listAllMessages,
  listConversations,
  listMessages,
  mergeConversationAliases,
  upsertMessages,
  setHistoryStart,
} from './message-db';

function makeMessage(
  conversationId: string,
  id: string,
  options: Partial<Pick<ChatMessage, 'capturedAt' | 'domOrder' | 'timestampMs'>> = {},
): ChatMessage {
  return {
    key: `${conversationId}:${id}`,
    id,
    conversationId,
    direction: 'incoming',
    kind: 'text',
    text: id,
    quotedText: null,
    sender: 'Partner',
    timestampRaw: '12:00',
    timestampMs: options.timestampMs ?? null,
    urls: [],
    mediaCount: 0,
    capturedAt: options.capturedAt ?? Date.now(),
    domOrder: options.domOrder ?? 0,
  };
}

describe('message database', () => {
  it('stores cross-surface aliases durably without a second message or repeated upload', async () => {
    const identity = { id: `cross_${crypto.randomUUID()}`, title: 'Same title', avatarKey: null };
    const web = makeMessage(identity.id, 'web-id', { timestampMs: 120000 });
    await upsertMessages(identity, [web]);
    const meta = { ...web, id: 'meta:meta-id', key: `${identity.id}:meta:meta-id`, sender: null, timestampRaw: '2026年8月21日 09:30' };
    expect(await upsertMessages(identity, [meta])).toEqual({ added: 0, changed: 0, total: 1 });
    expect((await listAllMessages(identity.id))[0]?.sourceAliases).toEqual(['meta:meta-id']);
    expect(await upsertMessages(identity, [{ ...meta, timestampMs: null }])).toEqual({ added: 0, changed: 0, total: 1 });
    expect(await upsertMessages(identity, [web])).toEqual({ added: 0, changed: 0, total: 1 });
    expect((await listAllMessages(identity.id))[0]?.sourceAliases).toEqual(['meta:meta-id']);
  });
  it('stores different full numbers independently even when their last five digits collide', async () => {
    const first = { id: `first_${crypto.randomUUID()}`, title: '+52 111 900 6182', avatarKey: null };
    const second = { id: `second_${crypto.randomUUID()}`, title: '+1 222 000 6182', avatarKey: null };
    const results = await Promise.allSettled([
      upsertMessages(first, [makeMessage(first.id, 'one')]),
      upsertMessages(second, [makeMessage(second.id, 'two')]),
    ]);
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(await listAllMessages(first.id)).toHaveLength(1);
    expect(await listAllMessages(second.id)).toHaveLength(1);
    expect((await listConversations()).some(record => record.id === second.id)).toBe(true);
  });
  it('persists scoped history metadata independently from message cursors, preserves it on capture, and clears it locally', async () => {
    const identity = { id: `chat_${crypto.randomUUID()}`, title: 'History marker', avatarKey: null };
    await upsertMessages(identity, [makeMessage(identity.id, 'first', { capturedAt: 123 })]);
    const historyStart = { messageId: 'first', detectedAt: 999 };
    expect(await setHistoryStart(identity.id, historyStart)).toBe(true);
    expect(await setHistoryStart(identity.id, { ...historyStart, detectedAt: 1000 })).toBe(false);
    await upsertMessages(identity, [makeMessage(identity.id, 'latest', { capturedAt: 456 })]);
    expect((await listConversations()).find((c) => c.id === identity.id)?.historyStart).toEqual(historyStart);
    expect((await listAllMessages(identity.id)).find((m) => m.id === 'first')?.capturedAt).toBe(123);
    await expect(setHistoryStart('another-chat', historyStart)).rejects.toThrow('尚未保存');
    await clearConversationMessages(identity.id);
    expect((await listConversations()).find((c) => c.id === identity.id)?.historyStart).toBeNull();
  });
  it('upserts messages without double counting duplicates', async () => {
    const identity: ConversationIdentity = {
      id: `chat_${crypto.randomUUID()}`,
      title: 'Test chat',
      avatarKey: null,
    };
    const first = await upsertMessages(identity, [
      makeMessage(identity.id, 'one'),
      makeMessage(identity.id, 'two'),
    ]);
    const second = await upsertMessages(identity, [makeMessage(identity.id, 'two')]);

    expect(first).toEqual({ added: 2, changed: 0, total: 2 });
    expect(second).toEqual({ added: 0, changed: 0, total: 2 });
    expect(await listMessages(identity.id)).toHaveLength(2);
    expect((await listConversations()).find((item) => item.id === identity.id)?.messageCount).toBe(2);
  });

  it('merges overlapping history snapshots into stable visual order', async () => {
    const identity: ConversationIdentity = {
      id: `chat_${crypto.randomUUID()}`,
      title: 'Ordered chat',
      avatarKey: null,
    };
    const minute = new Date(2026, 7, 29, 12, 0).getTime();
    await upsertMessages(identity, [
      makeMessage(identity.id, 'three', { timestampMs: minute, domOrder: 0, capturedAt: 100 }),
      makeMessage(identity.id, 'four', { timestampMs: minute, domOrder: 1, capturedAt: 100 }),
    ]);
    await upsertMessages(identity, [
      makeMessage(identity.id, 'one', { timestampMs: minute, domOrder: 0, capturedAt: 200 }),
      makeMessage(identity.id, 'two', { timestampMs: minute, domOrder: 1, capturedAt: 200 }),
      makeMessage(identity.id, 'three', { timestampMs: minute, domOrder: 2, capturedAt: 200 }),
    ]);

    expect((await listMessages(identity.id)).map((message) => message.id)).toEqual([
      'one',
      'two',
      'three',
      'four',
    ]);
  });

  it('reports only semantic message edits as changed', async () => {
    const identity: ConversationIdentity = {
      id: `chat_${crypto.randomUUID()}`,
      title: 'Edited chat',
      avatarKey: null,
    };
    const original = makeMessage(identity.id, 'one');
    await upsertMessages(identity, [original]);

    expect(await upsertMessages(identity, [{ ...original, capturedAt: original.capturedAt + 1000 }]))
      .toEqual({ added: 0, changed: 0, total: 1 });
    expect(await upsertMessages(identity, [{ ...original, text: 'edited', capturedAt: original.capturedAt + 2000 }]))
      .toEqual({ added: 0, changed: 1, total: 1 });
    expect((await listAllMessages(identity.id))[0]).toMatchObject({
      text: 'edited',
      capturedAt: original.capturedAt + 2000,
    });
  });

  it('clears only the selected conversation while preserving its record', async () => {
    const first: ConversationIdentity = {
      id: `chat_${crypto.randomUUID()}`,
      title: 'First chat',
      avatarKey: null,
    };
    const second: ConversationIdentity = {
      id: `chat_${crypto.randomUUID()}`,
      title: 'Second chat',
      avatarKey: null,
    };
    await upsertMessages(first, [makeMessage(first.id, 'one'), makeMessage(first.id, 'two')]);
    await upsertMessages(second, [makeMessage(second.id, 'other')]);

    expect(await clearConversationMessages(first.id)).toBe(2);
    expect(await listMessages(first.id)).toEqual([]);
    expect(await listMessages(second.id)).toHaveLength(1);
    expect((await listConversations()).find((item) => item.id === first.id)?.messageCount).toBe(0);
  });

  it('migrates avatar-based phone aliases into the stable conversation ID', async () => {
    const first: ConversationIdentity = {
      id: `chat_legacy_${crypto.randomUUID()}`,
      title: '+52 1 55 4720 5007',
      avatarKey: 'https://cdn.example.com/old.jpg',
    };
    const second: ConversationIdentity = {
      id: `chat_legacy_${crypto.randomUUID()}`,
      title: '+52 1 55 4720 5007',
      avatarKey: 'https://cdn.example.com/new.jpg',
    };
    const stable: ConversationIdentity = {
      id: `chat_stable_${crypto.randomUUID()}`,
      title: '+52 1 55 4720 5007',
      avatarKey: 'https://cdn.example.com/current.jpg',
    };
    await upsertMessages(first, [makeMessage(first.id, 'one'), makeMessage(first.id, 'shared')]);
    await upsertMessages(second, [makeMessage(second.id, 'shared'), makeMessage(second.id, 'two')]);

    await expect(mergeConversationAliases(stable)).resolves.toMatchObject({
      aliasIds: expect.arrayContaining([first.id, second.id]),
      total: 3,
    });
    expect((await listMessages(stable.id)).map((message) => message.id).sort())
      .toEqual(['one', 'shared', 'two']);
    expect(await listMessages(first.id)).toEqual([]);
    expect((await listConversations()).filter((item) => item.title === stable.title))
      .toEqual([expect.objectContaining({ id: stable.id, messageCount: 3 })]);
  });

  it('migrates one uniquely named legacy conversation without merging ambiguous names', async () => {
    const named: ConversationIdentity = {
      id: `chat_named_${crypto.randomUUID()}`,
      title: 'Palafox',
      avatarKey: 'https://cdn.example.com/old.jpg',
    };
    const renamedAvatar: ConversationIdentity = {
      id: `chat_named_${crypto.randomUUID()}`,
      title: 'Palafox',
      avatarKey: 'https://cdn.example.com/new.jpg',
    };
    await upsertMessages(named, [makeMessage(named.id, 'one')]);
    await expect(mergeConversationAliases(renamedAvatar)).resolves.toMatchObject({
      aliasIds: [named.id],
      total: 1,
    });

    const firstAlex: ConversationIdentity = {
      id: `chat_alex_${crypto.randomUUID()}`,
      title: 'Alex',
      avatarKey: 'https://cdn.example.com/alex-1.jpg',
    };
    const secondAlex: ConversationIdentity = {
      id: `chat_alex_${crypto.randomUUID()}`,
      title: 'Alex',
      avatarKey: 'https://cdn.example.com/alex-2.jpg',
    };
    await upsertMessages(firstAlex, [makeMessage(firstAlex.id, 'first')]);
    await upsertMessages(secondAlex, [makeMessage(secondAlex.id, 'second')]);
    await expect(mergeConversationAliases({
      id: `chat_alex_${crypto.randomUUID()}`,
      title: 'Alex',
      avatarKey: 'https://cdn.example.com/alex-new.jpg',
    })).resolves.toEqual({ aliasIds: [], total: 0 });
  });
});

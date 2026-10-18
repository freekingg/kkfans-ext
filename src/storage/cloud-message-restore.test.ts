import { describe, expect, it } from 'vitest';
import type { ChatMessage, ConversationRecord } from '../core/types';
import { importCloudConversations, importCloudMessages, listAllMessages, listConversations, upsertMessages, acknowledgeCloudMessages } from './message-db';

describe('cloud message restore', () => {
  it('keeps original times, deduplicates, and never treats downloaded data as new outgoing sync', async () => {
    const id = `restore_${crypto.randomUUID()}`;
    const record: ConversationRecord = { id, title: 'Partner', avatarKey: null, createdAt: 10, updatedAt: 20,
      lastCapturedAt: 20, messageCount: 1, oldestMessageId: 'm1', newestMessageId: 'm1' };
    const message: ChatMessage = { key: `${id}:m1`, id: 'm1', conversationId: id, direction: 'incoming', kind: 'text',
      text: 'Hola', quotedText: null, sender: null, timestampRaw: null, timestampMs: 15, urls: [], mediaCount: 0, capturedAt: 20, domOrder: 0 };
    await importCloudConversations([record]);
    await importCloudMessages([message, message]);
    expect(await listAllMessages(id)).toEqual([expect.objectContaining({ capturedAt: 20, cloudSynced: true })]);
    expect((await listConversations()).find(c => c.id === id)).toMatchObject({ createdAt: 10, updatedAt: 20 });
    await upsertMessages(record, [{ ...message, capturedAt: 30 }]);
    expect((await listAllMessages(id))[0]?.cloudSynced).toBe(true);
    await upsertMessages(record, [{ ...message, text: 'Edited', capturedAt: 40 }]);
    expect((await listAllMessages(id))[0]?.cloudSynced).not.toBe(true);
    await importCloudMessages([message]);
    expect((await listAllMessages(id))[0]?.text).toBe('Edited');
    // A delayed acknowledgement must not mark a newer local edit as uploaded.
    await acknowledgeCloudMessages([message]);
    expect((await listAllMessages(id))[0]?.cloudSynced).not.toBe(true);
    await acknowledgeCloudMessages(await listAllMessages(id));
    expect((await listAllMessages(id))[0]?.cloudSynced).toBe(true);
    await importCloudMessages([{ ...message, text: 'Cloud correction' }]);
    expect((await listAllMessages(id))[0]?.text).toBe('Cloud correction');
  });
});

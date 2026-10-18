import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', () => ({
  browser: { runtime: { getManifest: () => ({ version: '0.2.0' }) } },
}));

import type { ConversationRecord } from '../core/types';
import { uploadConversationBatch } from './cloud-client';

describe('cloud client', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: 200, message: '操作成功', data: { revision: 100, conversationId: 'chat_1', total: 5 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
  });

  it('即使没有新消息，也会上传已经确认的可见历史起点元数据', async () => {
    const historyStart = { messageId: 'first-message', detectedAt: 1788192000000 };
    const conversation = Object.assign({
      id: 'chat_1', title: 'Partner', avatarKey: null, createdAt: 1000, updatedAt: 2000,
      lastCapturedAt: 2000, messageCount: 5, oldestMessageId: 'first-message', newestMessageId: 'last-message',
    }, { historyStart });
    await uploadConversationBatch({
      settings: { username: 'king', whatsappAccount: '+521234567890' }, conversation,
      tagIds: [], tagDefinitions: [], note: null, profile: null, sopStage: null, sopStageHistory: [], messages: [],
    });
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body));
    expect(body.conversation.historyStart).toEqual(historyStart);
    expect(body.messages).toEqual([]);
  });

  it('旧会话没有起点信息时不会凭最早消息 ID 编造完整历史标记', async () => {
    await uploadConversationBatch({
      settings: { username: 'king', whatsappAccount: '+521234567890' },
      conversation: {
        id: 'chat_1', title: 'Partner', avatarKey: null, createdAt: 1000, updatedAt: 2000,
        lastCapturedAt: 2000, messageCount: 5, oldestMessageId: 'only-known-oldest', newestMessageId: 'last-message',
      },
      tagIds: [], tagDefinitions: [], note: null, profile: null, sopStage: null, sopStageHistory: [], messages: [],
    });
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body));
    expect(body.conversation).not.toHaveProperty('historyStart');
  });

  it('uploads username and WhatsApp account with an idempotent message key', async () => {
    const conversation: ConversationRecord = {
      id: 'chat_1',
      title: 'Partner',
      avatarKey: null,
      createdAt: 1000,
      updatedAt: 2000,
      lastCapturedAt: 2000,
      messageCount: 1,
      oldestMessageId: 'm1',
      newestMessageId: 'm1',
    };

    await uploadConversationBatch({
      settings: { username: 'king', whatsappAccount: '+521234567890' },
      conversation,
      tagIds: ['follow-up'],
      tagDefinitions: [{ id: 'follow-up', name: '待跟进', color: '#f59e0b' }],
      note: { text: '客户希望下周一继续跟进', updatedAt: 1800 },
      profile: {
        additionSource: 'comment',
        contactWhatsapp: '+52 123', platformAccount: 'player-8821', invitationUrl: 'https://example.com/invite/creator', followerData: '89.1K followers', instagramUsername: 'creator',
        instagramProfileUrl: 'https://www.instagram.com/creator/', country: '墨西哥',
        finalPrice: '400 USD', specialStatus: null, nextFollowUpAt: 2100,
        registeredDate: '2026-08-21', publishedDate: '', publishedUrl: '', updatedAt: 2000,
      },
      sopStage: {
        stageId: '06', source: 'ai-confirmed', confidence: 0.82,
        confirmedAt: 1900, updatedAt: 1900, sopKnowledgeVersion: 'sop-v1',
      },
      sopStageHistory: [{
        eventId: 'event-1', conversationId: 'chat_1', fromStageId: '05',
        toStageId: '06', source: 'ai-confirmed', confidence: 0.82,
        sopKnowledgeVersion: 'sop-v1', changedAt: 1900,
      }],
      messages: [
        {
          key: 'chat_1:m1',
          id: 'm1',
          conversationId: 'chat_1',
          direction: 'incoming',
          kind: 'text',
          text: 'Hola',
          quotedText: null,
          sender: 'Partner',
          timestampRaw: null,
          timestampMs: null,
          urls: [],
          mediaCount: 0,
          capturedAt: 2000,
          domOrder: 0,
        },
      ],
    });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      username: 'king',
      whatsappAccount: '+521234567890',
      pluginVersion: '0.2.0',
      schemaVersion: 9,
      conversation: {
        id: 'chat_1',
        tagIds: ['follow-up'],
        note: { text: '客户希望下周一继续跟进', updatedAt: 1800 },
        profile: expect.objectContaining({ additionSource: 'comment', platformAccount: 'player-8821', invitationUrl: 'https://example.com/invite/creator', followerData: '89.1K followers', instagramUsername: 'creator', finalPrice: '400 USD' }),
        sopStage: { stageId: '06', source: 'ai-confirmed' },
        sopStageHistory: [{ eventId: 'event-1', toStageId: '06' }],
      },
      messages: [{ key: 'chat_1:m1' }],
    });
  });

  it('把429转换为可退避重试的同步错误', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(
      JSON.stringify({ statusCode: 429, message: 'Too Many Requests' }),
      { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '12' } },
    ));

    await expect(uploadConversationBatch({
      settings: { username: 'king', whatsappAccount: '+521234567890' },
      conversation: {
        id: 'chat_1', title: 'Partner', avatarKey: null, createdAt: 1, updatedAt: 2,
        lastCapturedAt: 2, messageCount: 0, oldestMessageId: null, newestMessageId: null,
      },
      tagIds: [],
      tagDefinitions: [],
      note: null,
      profile: null,
      sopStage: null,
      sopStageHistory: [],
      messages: [],
    })).rejects.toMatchObject({
      status: 429,
      retryAfterMs: 12_000,
      message: '同步请求过于频繁，已进入自动退避队列',
    });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../core/types';
import { analyzeAiConversation, chatAiConversation, testAiConnection } from './ai-client';

describe('AI client', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('连接测试把本地厂商配置交给自己的服务端', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 200,
          message: '操作成功',
          data: { connected: true, model: 'vendor-chat', reply: 'OK' },
        }),
        { status: 200 },
      ),
    );
    await testAiConnection({
      baseUrl: 'https://provider.example/v1',
      apiKey: 'secret',
      model: 'vendor-chat',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/ai/openai-compatible/test'),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toEqual({
      provider: {
        baseUrl: 'https://provider.example/v1',
        apiKey: 'secret',
        model: 'vendor-chat',
      },
    });
  });

  it('服务地址被浏览器拦截时不暴露原始 Failed to fetch', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(testAiConnection({
      baseUrl: 'https://provider.example/v1',
      apiKey: 'secret',
      model: 'vendor-chat',
    })).rejects.toThrow(
      '无法连接 KKFans AI 服务。当前浏览器可能拦截了 kkfans.lllin.fun，请将该域名加入广告拦截或安全扩展的白名单后重试',
    );
  });

  it('应兼容服务端保活字节后的最终 JSON 响应', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        '   {"code":200,"message":"操作成功","data":{"connected":true,"model":"demo","reply":"OK"}}',
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(testAiConnection({
      baseUrl: 'https://provider.example/v1',
      apiKey: 'secret',
      model: 'demo',
    })).resolves.toMatchObject({
      connected: true,
      reply: 'OK',
    });
  });

  it('分析请求只发送最近120条消息', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 200,
          message: '操作成功',
          data: { summary: 'ok' },
        }),
        { status: 200 },
      ),
    );
    const messages = Array.from({ length: 130 }, (_, index) => ({
      key: `m-${index}`,
      id: `m-${index}`,
      conversationId: 'chat-1',
      direction: 'incoming',
      kind: 'text',
      text: `message ${index}`,
      quotedText: null,
      sender: 'Partner',
      timestampRaw: null,
      timestampMs: index,
      urls: [],
      mediaCount: 0,
      capturedAt: index,
      domOrder: index,
    })) as ChatMessage[];
    await analyzeAiConversation({
      settings: { baseUrl: 'https://provider.example/v1', apiKey: 'key', model: 'chat' },
      username: 'king',
      conversation: { id: 'chat-1', title: 'Partner', avatarKey: null },
      messages,
      tags: ['待跟进'],
      profile: {
        additionSource: 'comment',
        contactWhatsapp: '+52 123', platformAccount: 'player-8821', invitationUrl: 'https://example.com/invite/creator', followerData: '89.1K followers', instagramUsername: 'creator', instagramProfileUrl: '',
        country: '墨西哥', finalPrice: '400 USD', specialStatus: null,
        nextFollowUpAt: null, registeredDate: '', publishedDate: '', publishedUrl: '', updatedAt: 1,
      },
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.context.messages).toHaveLength(120);
    expect(body.userKey).toBe('king');
    expect(body.context.messages[0].key).toBe('m-10');
    expect(body.context.profile).toMatchObject({ platformAccount: 'player-8821', invitationUrl: 'https://example.com/invite/creator', followerData: '89.1K followers', instagramUsername: 'creator', finalPrice: '400 USD' });
  });

  it('自定义问答发送问题、分析摘要和最近20条历史', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 200,
          message: '操作成功',
          data: { answer: '建议先确认预算。', model: 'chat', usage: null, answeredAt: 'now', sopKnowledgeVersion: 'sop-v1' },
        }),
        { status: 200 },
      ),
    );
    const messages = [{
      key: 'm-1', id: 'm-1', conversationId: 'chat-1', direction: 'incoming', kind: 'text',
      text: 'Can you do 200?', quotedText: null, sender: 'Partner', timestampRaw: null,
      timestampMs: 1, urls: [], mediaCount: 0, capturedAt: 1, domOrder: 1,
    }] as ChatMessage[];
    const history = Array.from({ length: 24 }, (_, index) => ({
      id: `t-${index}`,
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: `turn ${index}`,
      createdAt: '2026-08-29T00:00:00.000Z',
    }));

    await chatAiConversation({
      settings: { baseUrl: 'https://provider.example/v1', apiKey: 'key', model: 'chat' },
      username: 'king',
      conversation: { id: 'chat-1', title: 'Partner', avatarKey: null },
      messages,
      tags: ['已报价'],
      question: ' 我应该怎么回复？ ',
      history,
      analysis: {
        summary: '正在谈价格', stageId: '06', confidence: 0.9, intent: '确认报价',
        evidence: [], risks: [], nextActions: ['确认预算'], replySuggestions: [],
        model: 'chat', usage: null, analyzedAt: '2026-08-29T00:00:00.000Z', sopKnowledgeVersion: 'sop-v1',
      },
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.question).toBe('我应该怎么回复？');
    expect(body.userKey).toBe('king');
    expect(body.history).toHaveLength(20);
    expect(body.history[0].content).toBe('turn 4');
    expect(body.analysis).toMatchObject({ stageId: '06', summary: '正在谈价格' });
  });
});

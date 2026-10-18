import { beforeEach, describe, expect, it, vi } from 'vitest';
import { splitTranslationText, translateWithGoogleFree } from './google-free-client';

describe('Google free translation client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([
      [['Hola, ', '你好，'], ['¿puedo publicar el vídeo hoy?', '今天可以发布视频吗？']],
      null,
      'zh-CN',
    ]), { status: 200, headers: { 'Content-Type': 'application/json' } })));
  });

  it('calls translate_a directly without an API key', async () => {
    await expect(translateWithGoogleFree('你好，今天可以发布视频吗？', 'zh-CN', 'es'))
      .resolves.toBe('Hola, ¿puedo publicar el vídeo hoy?');
    const requestUrl = new URL(String(vi.mocked(fetch).mock.calls[0]?.[0]));
    expect(requestUrl.origin + requestUrl.pathname)
      .toBe('https://translate.googleapis.com/translate_a/single');
    expect(requestUrl.searchParams.get('client')).toBe('gtx');
    expect(requestUrl.searchParams.get('sl')).toBe('zh-CN');
    expect(requestUrl.searchParams.get('tl')).toBe('es');
  });

  it('splits long text below a safe request size', () => {
    const chunks = splitTranslationText('这是一个比较长的句子。'.repeat(150));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => new TextEncoder().encode(chunk).length <= 1200)).toBe(true);
  });
});

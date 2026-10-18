import { describe, expect, it } from 'vitest';
import { normalizeAiSettings, validateAiSettings } from './settings';

describe('AI settings', () => {
  it('规范化兼容厂商地址、密钥和模型', () => {
    expect(
      normalizeAiSettings({
        baseUrl: ' https://provider.example/v1/ ',
        apiKey: ' key-123 ',
        model: ' vendor-chat ',
      }),
    ).toEqual({
      baseUrl: 'https://provider.example/v1',
      apiKey: 'key-123',
      model: 'vendor-chat',
    });
  });

  it('要求地址、密钥和模型完整配置', () => {
    expect(validateAiSettings({ baseUrl: '', apiKey: '', model: '' })).toBe('请输入模型接口地址');
    expect(
      validateAiSettings({ baseUrl: 'file:///tmp/model', apiKey: 'key', model: 'chat' }),
    ).toBe('模型接口地址只支持 HTTP 或 HTTPS');
    expect(
      validateAiSettings({ baseUrl: 'https://provider.example/v1', apiKey: '', model: 'chat' }),
    ).toBe('请输入模型 API Key');
    expect(
      validateAiSettings({ baseUrl: 'https://provider.example/v1', apiKey: 'key', model: '' }),
    ).toBe('请输入模型名称');
  });
});

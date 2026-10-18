import { describe, expect, it } from 'vitest';
import { normalizeCloudSettings, validateCloudSettings } from './settings';

describe('cloud settings', () => {
  it('trims username and removes all whitespace from WhatsApp account', () => {
    expect(
      normalizeCloudSettings({ username: ' king ', whatsappAccount: ' +52 123 456 ' }),
    ).toEqual({ username: 'king', whatsappAccount: '+52123456' });
  });

  it('requires both namespace fields and validates the account format', () => {
    expect(validateCloudSettings({ username: '', whatsappAccount: '' })).toBe('请输入用户名');
    expect(validateCloudSettings({ username: 'king', whatsappAccount: 'business-main' })).toBe(
      'WhatsApp 账号格式不正确',
    );
    expect(validateCloudSettings({ username: 'king', whatsappAccount: '+52 123-456-7890' })).toBe(
      'WhatsApp 账号不能包含空格',
    );
    expect(validateCloudSettings({ username: 'king', whatsappAccount: '+52123-456-7890' })).toBeNull();
  });
});

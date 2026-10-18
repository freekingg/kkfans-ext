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

import {
  DEFAULT_SOP_SETTINGS,
  getSopSettings,
  saveSopSettings,
  validateSopSettings,
} from './settings';

describe('SOP 页面配置', () => {
  beforeEach(() => {
    Object.keys(store).forEach((key) => delete store[key]);
  });

  it('未配置时使用 kkflow01 的默认 SOP 地址', async () => {
    await expect(getSopSettings()).resolves.toEqual({
      url: 'https://sop.lllin.fun/?user=kkflow01',
    });
    expect(DEFAULT_SOP_SETTINGS.url).toContain('user=kkflow01');
  });

  it('允许保存人工修改后的 HTTPS 地址', async () => {
    await saveSopSettings({ url: ' https://sop.lllin.fun/?user=king ' });
    await expect(getSopSettings()).resolves.toEqual({
      url: 'https://sop.lllin.fun/?user=king',
    });
  });

  it('拒绝无效或非 HTTPS 页面地址', () => {
    expect(validateSopSettings({ url: 'not-a-url' })).toBe('SOP 页面地址格式不正确');
    expect(validateSopSettings({ url: 'http://sop.example.com' })).toBe('SOP 页面地址必须使用 HTTPS');
  });
});

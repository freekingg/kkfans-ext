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

import { getCooperationProfiles, saveCooperationProfile } from './settings';

describe('cooperation profiles', () => {
  beforeEach(() => {
    Object.keys(store).forEach((key) => delete store[key]);
  });

  it.each(['comment', 'direct-message', 'email', 'referral'])('保存只有添加来源的资料：%s', async (additionSource) => {
    store.cooperationProfiles = { chat_source: { additionSource } };
    const profile = (await getCooperationProfiles()).chat_source!;
    expect(profile.additionSource).toBe(additionSource);
    expect(await saveCooperationProfile('chat_source', profile)).toMatchObject({ additionSource });
    await saveCooperationProfile('chat_source', { ...profile, additionSource: '' });
    expect((await getCooperationProfiles()).chat_source).toBeUndefined();
  });

  it('兼容旧资料，并把非法来源归为空值', async () => {
    store.cooperationProfiles = {
      legacy: { contactWhatsapp: '521234567890' },
      invalid: { contactWhatsapp: '521234567891', additionSource: 'invalid' },
    };
    const profiles = await getCooperationProfiles();
    expect(profiles.legacy?.additionSource).toBe('');
    expect(profiles.invalid?.additionSource).toBe('');
  });

  it('normalizes and saves the structured profile for one conversation', async () => {
    const profile = await saveCooperationProfile('chat_1', {
      contactWhatsapp: ' +52 123 456 ',
      platformAccount: '  player-8821  ',
      additionSource: 'email',
      invitationUrl: ' https://example.com/invite/creator ',
      followerData: ' 53 posts\r\n89.1K followers\r\n320 following ',
      instagramUsername: '',
      instagramProfileUrl: ' https://www.instagram.com/creator/ ',
      country: ' México ',
      finalPrice: ' 400 USD ',
      specialStatus: 'paused',
      nextFollowUpAt: 1788048000000,
      registeredDate: '2026-08-21',
      publishedDate: '2026-08-28',
      publishedUrl: ' https://www.instagram.com/reel/abc/ ',
      updatedAt: 1,
    });

    expect(profile).toMatchObject({
      contactWhatsapp: '+52 123 456',
      platformAccount: 'player-8821',
      additionSource: 'email',
      invitationUrl: 'https://example.com/invite/creator',
      followerData: '53 posts\n89.1K followers\n320 following',
      instagramUsername: 'creator',
      country: 'México',
      finalPrice: '400 USD',
      specialStatus: 'paused',
      registeredDate: '2026-08-21',
    });
    expect((await getCooperationProfiles()).chat_1).toEqual(profile);
  });

  it('从 Instagram 主页链接自动识别用户名，并兼容只有旧用户名的数据', async () => {
    const fromUrl = await saveCooperationProfile('chat_url', {
      additionSource: '',
      contactWhatsapp: '', platformAccount: '', invitationUrl: '', followerData: '', instagramUsername: '',
      instagramProfileUrl: 'https://www.instagram.com/creator.from.url/?hl=es',
      country: '', finalPrice: '', specialStatus: null, nextFollowUpAt: null,
      registeredDate: '', publishedDate: '', publishedUrl: '', updatedAt: 0,
    });
    const fromLegacyUsername = await saveCooperationProfile('chat_legacy', {
      additionSource: '',
      contactWhatsapp: '', platformAccount: '', invitationUrl: '', followerData: '', instagramUsername: '@legacy.creator',
      instagramProfileUrl: '', country: '', finalPrice: '', specialStatus: null,
      nextFollowUpAt: null, registeredDate: '', publishedDate: '', publishedUrl: '', updatedAt: 0,
    });

    expect(fromUrl).toMatchObject({
      instagramUsername: 'creator.from.url',
      instagramProfileUrl: 'https://www.instagram.com/creator.from.url/',
    });
    expect(fromLegacyUsername).toMatchObject({
      instagramUsername: 'legacy.creator',
      instagramProfileUrl: 'https://www.instagram.com/legacy.creator/',
    });
  });

  it('removes an empty profile and ignores invalid dates or status values', async () => {
    await saveCooperationProfile('chat_1', {
      additionSource: '',
      contactWhatsapp: '', platformAccount: '', invitationUrl: '', followerData: '', instagramUsername: '', instagramProfileUrl: '', country: '',
      finalPrice: '', specialStatus: 'invalid' as never, nextFollowUpAt: Number.NaN,
      registeredDate: '21/08/2026', publishedDate: 'nope', publishedUrl: '', updatedAt: 0,
    });

    expect((await getCooperationProfiles()).chat_1).toBeUndefined();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { store } = vi.hoisted(() => ({ store: {} as Record<string, unknown> }));

vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: vi.fn(async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(list.map((key) => [key, store[key]]));
        }),
        set: vi.fn(async (values: Record<string, unknown>) => Object.assign(store, values)),
      },
    },
  },
}));

import {
  DEFAULT_TAGS,
  getConversationTags,
  getTagDefinitions,
  migrateTagSettings,
  toggleConversationTag,
} from './settings';

describe('快速标签默认值迁移', () => {
  beforeEach(() => {
    Object.keys(store).forEach((key) => delete store[key]);
  });

  it('加入新标签、移除已合作，并保留用户自定义标签', async () => {
    store.tagDefinitions = [
      { id: 'follow-up', name: '待跟进', color: '#old' },
      { id: 'partnered', name: '已合作', color: '#10b981' },
      { id: 'custom-vip', name: '自定义 VIP', color: '#123456' },
    ];
    store.conversationTags = { chat_1: ['partnered', 'custom-vip', 'quoted'] };

    expect((await getTagDefinitions()).map((tag) => tag.name)).toEqual([
      '待跟进', '有意向', '已报价', '视频制作中', '视频待发布', '视频已发布', '已付款', '重点博主', '小弟博主', '放弃', '暂缓', '自定义 VIP',
    ]);
    expect(await getConversationTags()).toEqual({ chat_1: ['custom-vip', 'quoted'] });

    await migrateTagSettings();
    expect(store.tagDefinitions).toEqual(await getTagDefinitions());
    expect(store.conversationTags).toEqual({ chat_1: ['custom-vip', 'quoted'] });
    expect(DEFAULT_TAGS.some((tag) => tag.name === '已合作')).toBe(false);
    expect(DEFAULT_TAGS).toContainEqual({
      id: 'interested',
      name: '有意向',
      color: '#14b8a6',
    });
    expect(DEFAULT_TAGS).toContainEqual({
      id: 'video-pending-publish',
      name: '视频待发布',
      color: '#f97316',
    });
  });

  it('补齐小弟博主且重复迁移不重复添加，支持打标和取消', async () => {
    store.tagDefinitions = DEFAULT_TAGS.filter((tag) => tag.id !== 'junior-creator');
    store.conversationTags = { chat_1: ['key-creator'] };

    await migrateTagSettings();
    await migrateTagSettings();
    const tags = await getTagDefinitions();
    expect(tags.filter((tag) => tag.id === 'junior-creator')).toEqual([
      { id: 'junior-creator', name: '小弟博主', color: '#06b6d4' },
    ]);
    expect(tags.findIndex((tag) => tag.id === 'junior-creator'))
      .toBe(tags.findIndex((tag) => tag.id === 'key-creator') + 1);
    expect(await toggleConversationTag('chat_1', 'junior-creator'))
      .toEqual(['key-creator', 'junior-creator']);
    expect(await getConversationTags()).toEqual({ chat_1: ['key-creator', 'junior-creator'] });
    expect(await toggleConversationTag('chat_1', 'junior-creator')).toEqual(['key-creator']);
  });
});

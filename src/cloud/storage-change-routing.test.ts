import { describe, expect, it } from 'vitest';
import { cloudSyncStorageRoute } from './storage-change-routing';

describe('云同步存储变更路由', () => {
  it('单个会话资料变化时只同步该会话', () => {
    expect(cloudSyncStorageRoute({
      cooperationProfiles: {
        oldValue: { chat_1: { finalPrice: '300' }, chat_2: { finalPrice: '500' } },
        newValue: { chat_1: { finalPrice: '400' }, chat_2: { finalPrice: '500' } },
      },
    })).toEqual({ syncAll: false, conversationIds: ['chat_1'] });
  });

  it('删除备注也只同步对应会话', () => {
    expect(cloudSyncStorageRoute({
      conversationNotes: {
        oldValue: { chat_1: { text: '待跟进' } },
        newValue: {},
      },
    })).toEqual({ syncAll: false, conversationIds: ['chat_1'] });
  });

  it('账号或全局标签定义变化时同步全部会话', () => {
    expect(cloudSyncStorageRoute({ cloudSettings: { oldValue: {}, newValue: {} } }).syncAll)
      .toBe(true);
    expect(cloudSyncStorageRoute({ tagDefinitions: { oldValue: [], newValue: [] } }).syncAll)
      .toBe(true);
  });
});

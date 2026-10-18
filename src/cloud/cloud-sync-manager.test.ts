import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  storageState,
  storageGet,
  storageSet,
  alarmCreate,
  alarmClear,
  listConversations,
  listAllMessages,
  uploadConversationBatch,
  downloadCloudPage,
  saveCloudSyncState,
} = vi.hoisted(() => ({
  storageState: {} as Record<string, unknown>,
  storageGet: vi.fn().mockResolvedValue({}),
  storageSet: vi.fn().mockResolvedValue(undefined),
  alarmCreate: vi.fn().mockResolvedValue(undefined),
  alarmClear: vi.fn().mockResolvedValue(true),
  listConversations: vi.fn(),
  listAllMessages: vi.fn(),
  uploadConversationBatch: vi.fn(),
  downloadCloudPage: vi.fn(),
  saveCloudSyncState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('wxt/browser', () => ({
  browser: {
    storage: { local: { get: storageGet, set: storageSet } },
    alarms: { create: alarmCreate, clear: alarmClear },
  },
}));

vi.mock('../storage/message-db', () => ({ listConversations, listAllMessages, importCloudConversations: vi.fn(), importCloudMessages: vi.fn(), acknowledgeCloudMessages: vi.fn() }));
vi.mock('./cloud-client', () => ({ uploadConversationBatch, downloadCloudPage }));
vi.mock('./cloud-identity-migration', () => ({ migrateLocalConversationIdentities: vi.fn() }));
vi.mock('../storage/settings', () => ({
  DEFAULT_CLOUD_SYNC_STATE: {
    status: 'idle',
    pendingCount: 0,
    lastSyncedAt: null,
    error: null,
  },
  getCloudSettings: vi.fn().mockResolvedValue({
    username: 'king',
    whatsappAccount: '+521234567890',
  }),
  getConversationTags: vi.fn().mockResolvedValue({ chat_1: ['follow-up'] }),
  getConversationNotes: vi.fn().mockResolvedValue({
    chat_1: { text: '客户希望下周一继续跟进', updatedAt: 90 },
  }),
  getCooperationProfiles: vi.fn().mockResolvedValue({
    chat_1: {
      additionSource: 'referral',
      contactWhatsapp: '+52 123', platformAccount: 'player-8821', invitationUrl: 'https://example.com/invite/creator', followerData: '89.1K followers', instagramUsername: 'creator', instagramProfileUrl: '',
      country: '墨西哥', finalPrice: '400 USD', specialStatus: null,
      nextFollowUpAt: null, registeredDate: '', publishedDate: '', publishedUrl: '', updatedAt: 95,
    },
  }),
  getConversationSopStages: vi.fn().mockResolvedValue({
    chat_1: {
      stageId: '06', source: 'manual', confidence: null,
      confirmedAt: 100, updatedAt: 100, sopKnowledgeVersion: null,
    },
  }),
  getConversationSopStageHistory: vi.fn().mockResolvedValue([
    {
      eventId: 'event-1', conversationId: 'chat_1', fromStageId: null,
      toStageId: '06', source: 'manual', confidence: null,
      sopKnowledgeVersion: null, changedAt: 100,
    },
  ]),
  getTagDefinitions: vi.fn().mockResolvedValue([
    { id: 'follow-up', name: '待跟进', color: '#f59e0b' },
  ]),
  saveCloudSyncState,
  validateCloudSettings: vi.fn().mockReturnValue(null),
}));

import { CloudSyncManager } from './cloud-sync-manager';
import { getConversationNotes } from '../storage/settings';

describe('cloud sync manager', () => {
  const conversation = {
    id: 'chat_1',
    title: 'Partner',
    avatarKey: null,
    createdAt: 1,
    updatedAt: 2,
    lastCapturedAt: 2,
    messageCount: 201,
    oldestMessageId: 'm0',
    newestMessageId: 'm200',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(storageState).forEach((key) => delete storageState[key]);
    // Existing transport tests exercise the opt-in automatic mode.
    storageState.cloudReportPolicy = { autoSync: true, reported: { chat_1: 1 }, requests: {} };
    storageGet.mockImplementation(async (key: string | string[]) => {
      const keys = Array.isArray(key) ? key : [key];
      return Object.fromEntries(keys.map((item) => [item, storageState[item]]));
    });
    storageSet.mockImplementation(async (values: Record<string, unknown>) => {
      Object.assign(storageState, values);
    });
    listConversations.mockResolvedValue([conversation]);
    listAllMessages.mockResolvedValue(
      Array.from({ length: 201 }, (_, index) => ({
        key: `chat_1:m${index}`,
        id: `m${index}`,
        conversationId: 'chat_1',
        capturedAt: index + 1,
      })),
    );
    uploadConversationBatch.mockResolvedValue({ revision: 100, conversationId: 'chat_1', total: 201 });
    downloadCloudPage.mockResolvedValue({ records: [], tagDefinitions: [], nextCursor: null, serverTime: Date.now() });
  });

  it('首次全量同步按每批200条拆分并发布成功状态', async () => {
    const manager = new CloudSyncManager(0);
    await manager.enqueueAll();

    await vi.waitFor(() => expect(uploadConversationBatch).toHaveBeenCalledTimes(2));
    expect(uploadConversationBatch.mock.calls[0]![0].messages).toHaveLength(200);
    expect(uploadConversationBatch.mock.calls[1]![0].messages).toHaveLength(1);
    expect(uploadConversationBatch.mock.calls[0]![0]).toMatchObject({
      note: { text: '客户希望下周一继续跟进', updatedAt: 90 },
      profile: { additionSource: 'referral', platformAccount: 'player-8821', invitationUrl: 'https://example.com/invite/creator', followerData: '89.1K followers', instagramUsername: 'creator', finalPrice: '400 USD' },
      sopStage: { stageId: '06' },
      sopStageHistory: [{ eventId: 'event-1' }],
    });
    await vi.waitFor(() =>
      expect(saveCloudSyncState).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'success', pendingCount: 0 }),
      ),
    );
  });

  it('上传失败时保留队列并创建一分钟后的重试任务', async () => {
    uploadConversationBatch.mockRejectedValueOnce(new Error('offline'));
    const manager = new CloudSyncManager(0);
    await manager.enqueueAll();

    await vi.waitFor(() =>
      expect(saveCloudSyncState).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'error', pendingCount: 1, error: 'offline' }),
      ),
    );
    expect(alarmCreate).toHaveBeenCalledWith('kkfans-whatsapp-cloud-sync', {
      delayInMinutes: 1,
    });
  });

  it('云端消息少于本地时忽略旧同步标记并完整补传', async () => {
    const manager = new CloudSyncManager(0);
    await manager.enqueueAll();
    await vi.waitFor(() => expect(saveCloudSyncState).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'success' }),
    ));

    const baseline = (storageState.cloudMetadataBaselines as Record<string, { messageCount?: number }>).chat_1!;
    baseline.messageCount = 0;
    const localMessages = Array.from({ length: 14 }, (_, index) => ({
      key: `chat_1:repair-${index}`,
      id: `repair-${index}`,
      conversationId: 'chat_1',
      capturedAt: index + 1,
      cloudSynced: true,
    }));
    listAllMessages.mockResolvedValue(localMessages);
    uploadConversationBatch.mockClear();
    uploadConversationBatch.mockResolvedValue({ revision: 101, conversationId: 'chat_1', total: 14 });

    await manager.enqueueConversation('chat_1');
    await vi.waitFor(() => expect(uploadConversationBatch).toHaveBeenCalledTimes(1));
    expect(uploadConversationBatch.mock.calls[0]![0].messages).toEqual(localMessages);
    await vi.waitFor(() => expect(saveCloudSyncState).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'success' }),
    ));
    expect((storageState.cloudMetadataBaselines as Record<string, { messageCount: number }>).chat_1!.messageCount).toBe(14);
  });

  it('首次同步后仅上传新增消息，纯资料变化只发送空消息批次', async () => {
    const manager = new CloudSyncManager(0);
    await manager.enqueueAll();
    await vi.waitFor(() => expect(uploadConversationBatch).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(saveCloudSyncState).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'success' }),
    ));

    uploadConversationBatch.mockClear();
    await manager.enqueueConversation('chat_1');
    await vi.waitFor(() => expect(saveCloudSyncState).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'success', pendingCount: 0 }),
    ));
    expect(uploadConversationBatch).not.toHaveBeenCalled();
    vi.mocked(getConversationNotes).mockResolvedValue({ chat_1: { text: '修改后的备注', updatedAt: 200 } });
    await manager.enqueueConversation('chat_1');
    await vi.waitFor(() => expect(uploadConversationBatch).toHaveBeenCalledTimes(1));
    expect(uploadConversationBatch.mock.calls[0]![0].messages).toEqual([]);
    expect(uploadConversationBatch.mock.calls[0]![0].metadataFields).toEqual(['note']);
    await vi.waitFor(() => expect(saveCloudSyncState).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'success' }),
    ));

    uploadConversationBatch.mockClear();
    listAllMessages.mockResolvedValue([
      ...Array.from({ length: 201 }, (_, index) => ({
        key: `chat_1:m${index}`,
        id: `m${index}`,
        conversationId: 'chat_1',
        capturedAt: index + 1,
      })),
      { key: 'chat_1:m201', id: 'm201', conversationId: 'chat_1', capturedAt: 202 },
    ]);
    await manager.enqueueConversation('chat_1');
    await vi.waitFor(() => expect(uploadConversationBatch).toHaveBeenCalledTimes(1));
    expect(uploadConversationBatch.mock.calls[0]![0].messages).toEqual([
      expect.objectContaining({ key: 'chat_1:m201' }),
    ]);
  });

  it('遇到429时保留队列并按 Retry-After 延迟重试', async () => {
    uploadConversationBatch.mockRejectedValueOnce(Object.assign(
      new Error('rate limited'),
      { status: 429, retryAfterMs: 90_000 },
    ));
    const manager = new CloudSyncManager(0);
    await manager.enqueueAll();

    await vi.waitFor(() => expect(saveCloudSyncState).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        pendingCount: 1,
        error: '同步请求过于频繁，约 95 秒后自动重试',
      }),
    ));
    expect(alarmCreate).toHaveBeenCalledWith('kkfans-whatsapp-cloud-sync', {
      delayInMinutes: 95_000 / 60_000,
    });
  });

  it('does not drop a manual download queued while an empty cached pass is running', async () => {
    listConversations.mockResolvedValue([]);
    storageState.cloudRecoveryState = { schemaVersion: 9, lastPullAt: Date.now(), since: 10000 };
    const originalGet = storageGet.getMockImplementation()!;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let waiting = false;
    storageGet.mockImplementation(async (keys: string | string[]) => {
      if (keys === 'cloudMetadataConflicts' && !waiting) {
        waiting = true;
        await gate;
      }
      return originalGet(keys);
    });
    const manager = new CloudSyncManager(0);
    await manager.retry();
    await vi.waitFor(() => expect(waiting).toBe(true));
    await manager.enqueueAll();
    release();
    await vi.waitFor(() => expect(downloadCloudPage).toHaveBeenCalled());
    await vi.waitFor(() => expect(saveCloudSyncState).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'success' })));
  });

});

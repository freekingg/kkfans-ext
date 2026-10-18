import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCloudSettings } from '../storage/settings';

const mocks = vi.hoisted(() => {
  const event = () => ({ addListener: vi.fn(), removeListener: vi.fn() });
  return {
    browser: { storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => {}) }, onChanged: event() },
      runtime: { onMessage: event(), onInstalled: event() }, alarms: { onAlarm: event(), clear: vi.fn(async () => true) } },
    enqueueAll: vi.fn(async () => {}),
    conversations: [{ id: 'restored-contact', title: 'Contact', messageCount: 2 }],
    messages: [{ id: 'm1', conversationId: 'restored-contact', text: 'restored message' }],
    context: { available: true, conversation: { id: 'restored-contact', title: 'Contact', avatarKey: null } },
  };
});
vi.mock('wxt/browser', () => ({ browser: mocks.browser }));
vi.mock('../cloud/cloud-sync-manager', () => ({ CloudSyncManager: class {
  start = vi.fn(async () => {});
  isRestoring = () => false;
  enqueueAll = mocks.enqueueAll;
} }));
vi.mock('../storage/settings', () => ({
  migrateTagSettings: vi.fn(async () => {}), DEFAULT_AI_SETTINGS: {}, DEFAULT_CAPTURE_SETTINGS: {}, DEFAULT_SOP_SETTINGS: {}, DEFAULT_TAGS: [],
  getCloudSettings: vi.fn(async () => ({ username: 'operator', whatsappAccount: '+521234567890' })),
  getCooperationProfiles: vi.fn(async () => ({})),
  validateCloudSettings: () => null, mergeConversationStorageAliases: vi.fn(async () => []),
}));
vi.mock('../storage/message-db', () => ({
  listConversations: vi.fn(async () => mocks.conversations), listMessages: vi.fn(async () => mocks.messages),
  listMessageKeys: vi.fn(async () => ['m1']), clearConversationMessages: vi.fn(),
  mergeConversationAliases: vi.fn(async () => ({ aliasIds: [], total: 2 })), upsertMessages: vi.fn(), setHistoryStart: vi.fn(),
}));
vi.mock('../cloud/cloud-recovery', () => ({ migrateCloudAliases: vi.fn() }));
vi.mock('../storage/ai-chat-store', () => ({ mergeAiChatSessionAliases: vi.fn() }));
vi.mock('../content/conversation-controller', () => ({ ConversationController: class {
  start = vi.fn(); stop = vi.fn(); refreshTags = vi.fn(); getContext = () => mocks.context;
} }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('browser', mocks.browser);
  vi.stubGlobal('defineBackground', (main: () => void) => ({ main }));
  vi.stubGlobal('defineContentScript', (options: unknown) => options);
});

async function backgroundListener() {
  const { default: entry } = await import('../entrypoints/background');
  entry.main();
  return mocks.browser.runtime.onMessage.addListener.mock.calls.at(-1)![0];
}

describe('native callback-only Chromium message channels', () => {
  it.each([
    [{ type: 'db:list-conversations' }, { ok: true, conversations: mocks.conversations }],
    [{ type: 'db:list-messages', conversationId: 'restored-contact', limit: 120 }, { ok: true, messages: mocks.messages }],
    [{ type: 'cloud:sync-all' }, { ok: false, error: '当前版本仅本地保存，已停用云端同步与上报' }],
  ])('keeps the background response channel open for %j', async (request, expected) => {
    const listener = await backgroundListener();
    const sendResponse = vi.fn();
    // Old Chromium ignores a returned Promise. Only literal true retains the
    // callback channel; do not await the listener as the old tests did.
    expect(listener(request, {}, sendResponse)).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledExactlyOnceWith(expected));
  });

  it('returns background errors through the response callback', async () => {
    const listener = await backgroundListener();
    const { listConversations } = await import('../storage/message-db');
    vi.mocked(listConversations).mockRejectedValueOnce(new Error('Cannot open local database'));
    const sendResponse = vi.fn();
    expect(listener({ type: 'db:list-conversations' }, {}, sendResponse)).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: 'Cannot open local database' }));
  });

  it('does not claim messages intended for a different listener', async () => {
    const listener = await backgroundListener();
    const sendResponse = vi.fn();
    expect(listener({ type: 'content:get-context' }, {}, sendResponse)).toBeUndefined();
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it('disables legacy reports and removes old sync alarms', async () => {
    const listener = await backgroundListener();
    const sendResponse = vi.fn();
    listener({ type: 'cloud:report', conversationId: 'restored-contact' }, {}, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: '当前版本仅本地保存，已停用云端同步与上报' }));
    expect(mocks.enqueueAll).not.toHaveBeenCalled();
    expect(mocks.browser.alarms.clear).toHaveBeenCalledTimes(2);
    expect(mocks.browser.alarms.onAlarm.addListener).not.toHaveBeenCalled();
  });

  it('starts the page without a configured username or number', async () => {
    vi.mocked(getCloudSettings).mockResolvedValueOnce({ username: '', whatsappAccount: '' });
    const { default: entry } = await import('../entrypoints/whatsapp.content');
    await entry.main({ onInvalidated: vi.fn() } as never);
    const listener = mocks.browser.runtime.onMessage.addListener.mock.calls.at(-1)![0];
    const sendResponse = vi.fn();
    listener({ type: 'content:refresh-tags' }, {}, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true }));
  });

  it('delivers the current contact from content script to panel through a callback', async () => {
    const { default: entry } = await import('../entrypoints/whatsapp.content');
    await entry.main({ onInvalidated: vi.fn() } as never);
    const listener = mocks.browser.runtime.onMessage.addListener.mock.calls.at(-1)![0];
    const sendResponse = vi.fn();
    expect(listener({ type: 'content:get-context' }, {}, sendResponse)).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: true, context: mocks.context }));
  });

  it('keeps the page reachable when initialization fails and retries initialization on the next request', async () => {
    vi.mocked(getCloudSettings).mockRejectedValueOnce(new Error('Storage unavailable'))
      .mockRejectedValueOnce(new Error('Storage unavailable'));
    const { default: entry } = await import('../entrypoints/whatsapp.content');
    await entry.main({ onInvalidated: vi.fn() } as never);
    const listener = mocks.browser.runtime.onMessage.addListener.mock.calls.at(-1)![0];
    const first = vi.fn();
    expect(listener({ type: 'content:get-context' }, {}, first)).toBe(true);
    await vi.waitFor(() => expect(first).toHaveBeenCalledWith({ ok: false, error: 'WhatsApp 页面脚本初始化失败：Storage unavailable' }));
    const second = vi.fn();
    listener({ type: 'content:get-context' }, {}, second);
    await vi.waitFor(() => expect(second).toHaveBeenCalledWith({ ok: true, context: mocks.context }));
  });
});

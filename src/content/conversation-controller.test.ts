import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationIdentity } from '../core/types';

const mocks = vi.hoisted(() => ({
  pageToken: '',
  identity: null as ConversationIdentity | null,
  loader: {
    getState: vi.fn(() => ({
      status: 'idle', conversationId: null, title: null, captured: 0,
      rounds: 0, startedAt: null, updatedAt: 0, note: '',
    })),
    start: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn(),
    reset: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
  },
  tags: {
    start: vi.fn(),
    stop: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined),
    reconcileVisibleRows: vi.fn(),
  },
  liveMessages: {
    start: vi.fn(),
    stop: vi.fn(),
  },
}));

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: {
      sendMessage: vi.fn().mockResolvedValue({ ok: true, aliasIds: [], total: 0 }),
    },
  },
}));

vi.mock('../whatsapp/conversation-identity', () => ({
  getActiveConversationIdentity: () => mocks.identity,
  getActiveConversationMatchError: () => null,
}));

vi.mock('../platforms/page-target', () => ({ isMetaHost: () => false, pageConversationToken: () => mocks.pageToken }));

vi.mock('../whatsapp/history-loader', () => ({
  HistoryLoader: class {
    constructor() { return mocks.loader; }
  },
}));

vi.mock('../whatsapp/live-message-observer', () => ({
  LiveMessageObserver: class {
    constructor() { return mocks.liveMessages; }
  },
}));

vi.mock('./chat-tag-renderer', () => ({
  ChatTagRenderer: class {
    constructor() { return mocks.tags; }
  },
}));

import { ConversationController } from './conversation-controller';

describe('conversation controller manual capture policy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-30T00:00:00Z'));
    vi.clearAllMocks();
    mocks.pageToken = '';
    mocks.loader.reset.mockResolvedValue(undefined);
    mocks.tags.refresh.mockResolvedValue(undefined);
    document.body.innerHTML = `
      <div id="main">
        <header data-testid="conversation-header"></header>
        <div data-testid="conversation-panel-messages">
          <div data-testid="conv-msg-A"></div>
        </div>
      </div>
    `;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('never starts message capture merely because conversations switch quickly', async () => {
    const controller = new ConversationController();
    const check = () => (controller as unknown as { checkConversation(): Promise<void> }).checkConversation();

    mocks.identity = { id: 'chat-a', title: 'Chat A', avatarKey: null };
    await check();
    await vi.advanceTimersByTimeAsync(500);

    mocks.identity = { id: 'chat-b', title: 'Chat B', avatarKey: null };
    document.querySelector('[data-testid="conv-msg-A"]')?.setAttribute('data-testid', 'conv-msg-B');
    await check();
    await vi.advanceTimersByTimeAsync(500);

    expect(mocks.loader.reset).toHaveBeenCalledTimes(2);
    expect(mocks.loader.reset).toHaveBeenLastCalledWith(mocks.identity);
    expect(mocks.liveMessages.start).toHaveBeenCalledTimes(2);
    expect(mocks.tags.reconcileVisibleRows).toHaveBeenCalledTimes(2);
    expect(mocks.tags.refresh).not.toHaveBeenCalled();
    expect(mocks.loader.start).not.toHaveBeenCalled();
  });
  it('blocks capture when Meta changes its URL before replacing the old header/messages', async () => {
    const controller = new ConversationController();
    const check = () => (controller as unknown as { checkConversation(): Promise<void> }).checkConversation();
    mocks.identity = { id: 'a', title: 'A', avatarKey: null };
    mocks.pageToken = 'asset:thread-a';
    await check();
    await vi.advanceTimersByTimeAsync(550);
    expect(mocks.liveMessages.start).toHaveBeenCalledTimes(1);
    mocks.pageToken = 'asset:thread-b';
    expect(controller.getContext().conversation).toBeNull();
    await check();
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.liveMessages.start).toHaveBeenCalledTimes(1);
    await expect(controller.startCapture()).rejects.toThrow('正在切换');
    mocks.identity = { id: 'b', title: 'B', avatarKey: null };
    document.querySelector('[data-testid="conv-msg-A"]')?.setAttribute('data-testid', 'conv-msg-B');
    await check();
    await vi.advanceTimersByTimeAsync(550);
    expect(mocks.liveMessages.start).toHaveBeenCalledTimes(2);
    expect(controller.getContext().conversation?.id).toBe('b');
    controller.stop();
  });
});

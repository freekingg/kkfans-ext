import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMessage } = vi.hoisted(() => ({
  sendMessage: vi.fn(),
}));

vi.mock('wxt/browser', () => ({
  browser: { runtime: { sendMessage } },
}));

import { getActiveConversationIdentity } from './conversation-identity';
import { HistoryLoader } from './history-loader';

describe('history loader incremental capture', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sendMessage.mockReset();
    document.body.innerHTML = `
      <div id="main">
        <header data-testid="conversation-header">
          <span data-testid="conversation-info-header-chat-title" title="Palafox"></span>
        </header>
        <div data-testid="conversation-panel-messages">
          <div class="message-in" data-testid="conv-msg-KNOWN">
            <div data-testid="msg-container">
              <div data-pre-plain-text="[10:00, 29/08/2026] Palafox: ">
                <span data-testid="selectable-text">Old message</span>
              </div>
            </div>
          </div>
          <div class="message-in" data-testid="conv-msg-NEW">
            <div data-testid="msg-container">
              <div data-pre-plain-text="[10:01, 29/08/2026] Palafox: ">
                <span data-testid="selectable-text">New message</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('continues toward older history even when the visible batch is already known', async () => {
    const identity = getActiveConversationIdentity()!;
    let upsertCount = 0;
    sendMessage.mockImplementation(async (request: { type: string }) => {
      if (request.type === 'db:list-message-keys') {
        return { ok: true, messageKeys: [`${identity.id}:KNOWN`] };
      }
      if (request.type === 'db:upsert-messages') {
        upsertCount += 1;
        return { ok: true, added: upsertCount === 1 ? 1 : 0, changed: 0, total: 2 };
      }
      return { ok: true };
    });

    const loader = new HistoryLoader();
    const capture = loader.start(identity, { maxRounds: 3, settleMs: 10 });
    await vi.runAllTimersAsync();
    await capture;

    const upserts = sendMessage.mock.calls.filter(([request]) => request.type === 'db:upsert-messages');
    expect(upserts).toHaveLength(4);
    expect(loader.getState()).toMatchObject({
      status: 'complete',
      conversationId: identity.id,
      captured: 2,
      rounds: 3,
    });
    // No explicit start-of-history evidence exists in this fixture.
    expect(loader.getState().note).not.toMatch(/完整历史同步完成|历史补齐完成/);
  });

  it('达到安全轮次上限不会宣称已经读到最早历史', async () => {
    const identity = getActiveConversationIdentity()!;
    sendMessage.mockImplementation(async (request: { type: string }) => {
      if (request.type === 'db:list-message-keys') return { ok: true, messageKeys: [] };
      if (request.type === 'db:upsert-messages') return { ok: true, added: 2, changed: 0, total: 2 };
      return { ok: true };
    });
    const loader = new HistoryLoader();
    const capture = loader.start(identity, { maxRounds: 1, settleMs: 10 });
    await vi.runAllTimersAsync();
    await capture;
    expect(loader.getState().note).toContain('上限');
    expect(loader.getState().note).not.toMatch(/完整历史同步完成|历史补齐完成/);
    expect(sendMessage.mock.calls.some(([request]) => request.conversation?.historyStart != null)).toBe(false);
  });

  it('persists a stable explicit start marker even when all messages are already known', async () => {
    const identity = getActiveConversationIdentity()!;
    document.querySelector('[data-testid="conversation-panel-messages"]')!.insertAdjacentHTML('afterbegin',
      '<div data-testid="e2e-notification">Messages and calls are end-to-end encrypted.</div>');
    sendMessage.mockImplementation(async (request: { type: string }) => {
      if (request.type === 'db:list-message-keys') return { ok: true, messageKeys: [`${identity.id}:KNOWN`] };
      if (request.type === 'db:upsert-messages') return { ok: true, added: 0, changed: 0, total: 2 };
      return { ok: true };
    });
    const loader = new HistoryLoader();
    const capture = loader.start(identity, { maxRounds: 3, settleMs: 10 });
    await vi.runAllTimersAsync();
    await capture;
    expect(sendMessage).toHaveBeenCalledWith({ type: 'db:set-history-start', conversationId: identity.id,
      historyStart: { messageId: 'KNOWN', detectedAt: expect.any(Number) } });
    expect(loader.getState().note).toContain('最早可见');
  });

  it.each(['switch', 'cancel', 'pause'])('does not commit a start marker after %s', async (action) => {
    const identity = getActiveConversationIdentity()!;
    document.querySelector('[data-testid="conversation-panel-messages"]')!.insertAdjacentHTML('afterbegin',
      '<div data-testid="e2e-notification">Messages and calls are end-to-end encrypted.</div>');
    const loader = new HistoryLoader();
    sendMessage.mockImplementation(async (request: { type: string }) => {
      if (request.type === 'db:list-message-keys') return { ok: true, messageKeys: [] };
      if (request.type === 'db:upsert-messages') {
        if (action === 'switch') document.querySelector('[data-testid="conversation-info-header-chat-title"]')!.setAttribute('title', 'Different');
        else if (action === 'cancel') loader.cancel();
        else loader.pause();
        return { ok: true, added: 0, changed: 0, total: 2 };
      }
      return { ok: true };
    });
    const capture = loader.start(identity, { maxRounds: 3, settleMs: 10 });
    await vi.runAllTimersAsync();
    await capture;
    expect(sendMessage.mock.calls.some(([request]) => request.type === 'db:set-history-start')).toBe(false);
  });
});

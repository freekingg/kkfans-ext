import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMessage } = vi.hoisted(() => ({
  sendMessage: vi.fn().mockResolvedValue({ ok: true, added: 0, changed: 0, total: 1 }),
}));

vi.mock('wxt/browser', () => ({
  browser: { runtime: { sendMessage } },
}));

import { getActiveConversationIdentity } from './conversation-identity';
import { LiveMessageObserver } from './live-message-observer';
import { queryMessageScroller } from './selectors';

describe('live message observer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sendMessage.mockClear();
    document.body.innerHTML = `
      <div id="main">
        <header data-testid="conversation-header">
          <span data-testid="conversation-info-header-chat-title" title="Palafox"></span>
        </header>
        <div data-testid="conversation-panel-messages">
          <div class="message-in" data-testid="conv-msg-ONE">
            <div data-testid="msg-container">
              <div data-pre-plain-text="[10:00, 29/08/2026] Palafox: ">
                <span data-testid="selectable-text">Hola</span>
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

  it('skips hover-only DOM mutations but persists semantic message edits', async () => {
    const observer = new LiveMessageObserver();
    const identity = getActiveConversationIdentity()!;
    const scroller = queryMessageScroller()!;
    observer.start(identity, scroller);

    await vi.advanceTimersByTimeAsync(180);
    const upsertCalls = () => sendMessage.mock.calls
      .filter(([request]) => request.type === 'db:upsert-messages');
    expect(upsertCalls()).toHaveLength(1);

    const hoverButton = document.createElement('button');
    hoverButton.textContent = 'react';
    document.querySelector('[data-testid="msg-container"]')!.append(hoverButton);
    await vi.advanceTimersByTimeAsync(350);
    expect(upsertCalls()).toHaveLength(1);

    document.querySelector('[data-testid="selectable-text"]')!.textContent = 'Hola editado';
    await vi.advanceTimersByTimeAsync(350);
    expect(upsertCalls()).toHaveLength(2);

    observer.stop();
  });
});

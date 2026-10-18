import { browser } from 'wxt/browser';
import type { BackgroundRequest, BackgroundResponse } from '../core/runtime-messages';
import type { ConversationIdentity } from '../core/types';
import { getActiveConversationIdentity } from './conversation-identity';
import { extractVisibleMessages } from './message-extractor';
import { queryMessageScroller, selectors } from './selectors';
import { pageConversationToken } from '../platforms/page-target';

export class LiveMessageObserver {
  private observer: MutationObserver | null = null;
  private timer = 0;
  private identity: ConversationIdentity | null = null;
  private scroller: HTMLElement | null = null;
  private generation = 0;
  private lastSnapshotSignature = '';
  private pendingSnapshotSignature = '';
  private pageToken = '';

  start(identity: ConversationIdentity, scroller: HTMLElement): void {
    this.stop();
    this.identity = identity;
    this.scroller = scroller;
    this.pageToken = pageConversationToken();
    this.generation += 1;
    this.lastSnapshotSignature = '';
    this.pendingSnapshotSignature = '';
    this.observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => this.isMessageMutation(mutation))) this.schedule();
    });
    this.observer.observe(scroller, { childList: true, characterData: true, subtree: true });
    this.schedule(180);
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    window.clearTimeout(this.timer);
    this.identity = null;
    this.scroller = null;
    this.generation += 1;
    this.lastSnapshotSignature = '';
    this.pendingSnapshotSignature = '';
  }

  private schedule(delay = 300): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.persist(), delay);
  }

  private async persist(): Promise<void> {
    const identity = this.identity;
    const scroller = this.scroller;
    const generation = this.generation;
    if (!identity || !scroller) return;
    if (pageConversationToken() !== this.pageToken) return;
    if (!scroller.isConnected || queryMessageScroller() !== scroller) return;
    if (getActiveConversationIdentity()?.id !== identity.id || pageConversationToken() !== this.pageToken) return;
    const messages = extractVisibleMessages(identity.id, scroller);
    const signature = this.snapshotSignature(messages);
    if (signature === this.lastSnapshotSignature || signature === this.pendingSnapshotSignature) return;
    if (generation !== this.generation || this.identity?.id !== identity.id) return;
    if (getActiveConversationIdentity()?.id !== identity.id) return;
    const request: BackgroundRequest = {
      type: 'db:upsert-messages',
      conversation: identity,
      messages,
    };
    this.pendingSnapshotSignature = signature;
    try {
      const response = (await browser.runtime.sendMessage(request)) as BackgroundResponse;
      if (
        generation === this.generation &&
        this.identity?.id === identity.id &&
        response &&
        typeof response === 'object' &&
        'ok' in response &&
        response.ok
      ) {
        this.lastSnapshotSignature = signature;
        if ('added' in response && (response.added > 0 || response.changed > 0)) {
          await browser.runtime.sendMessage({
            type: 'capture:publish-state',
            state: {
              status: 'idle',
              conversationId: identity.id,
              title: identity.title,
              captured: response.total,
              rounds: 0,
              startedAt: null,
              updatedAt: Date.now(),
              note: response.added > 0
                ? `自动捕获 ${response.added} 条新消息`
                : `自动更新 ${response.changed} 条消息`,
            },
          } satisfies BackgroundRequest);
        }
      }
    } catch {
      // The extension may be reloading during development; the next mutation retries.
    } finally {
      if (this.pendingSnapshotSignature === signature) this.pendingSnapshotSignature = '';
    }
  }

  private isMessageMutation(mutation: MutationRecord): boolean {
    const target = mutation.target instanceof Element
      ? mutation.target
      : mutation.target.parentElement;
    if (target?.closest(selectors.messageContainers)) return true;
    return [...mutation.addedNodes, ...mutation.removedNodes].some((node) => {
      if (!(node instanceof Element)) return false;
      return (
        node.matches(selectors.messageContainers) ||
        node.matches(selectors.messageWrapper) ||
        Boolean(node.querySelector(selectors.messageContainers)) ||
        Boolean(node.querySelector(selectors.messageWrapper))
      );
    });
  }

  private snapshotSignature(messages: ReturnType<typeof extractVisibleMessages>): string {
    return JSON.stringify(messages.map((message) => [
      message.id,
      message.direction,
      message.kind,
      message.text,
      message.quotedText,
      message.sender,
      message.timestampRaw,
      message.urls,
      message.mediaCount,
    ]));
  }
}

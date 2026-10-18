import type { ActiveContext, ConversationIdentity } from '../core/types';
import type { BackgroundRequest, BackgroundResponse } from '../core/runtime-messages';
import { browser } from 'wxt/browser';
import { getCaptureSettings } from '../storage/settings';
import { getActiveConversationIdentity, getActiveConversationMatchError } from '../whatsapp/conversation-identity';
import { HistoryLoader } from '../whatsapp/history-loader';
import { LiveMessageObserver } from '../whatsapp/live-message-observer';
import {
  queryConversationMain,
  queryMessageScroller,
  selectorHealth,
  selectors,
} from '../whatsapp/selectors';
import { ChatTagRenderer } from './chat-tag-renderer';
import { isMetaHost, pageConversationToken } from '../platforms/page-target';

async function sendBackground(request: BackgroundRequest): Promise<BackgroundResponse> {
  return (await browser.runtime.sendMessage(request)) as BackgroundResponse;
}

export class ConversationController {
  private observer: MutationObserver | null = null;
  private timer = 0;
  private switchGeneration = 0;
  private activeIdentity: ConversationIdentity | null = null;
  private pendingIdentity: ConversationIdentity | null = null;
  private pendingSince = 0;
  private activeMessageFingerprint = '';
  private pendingMessageFingerprint = '';
  private loader = new HistoryLoader();
  private liveMessages = new LiveMessageObserver();
  private tags = new ChatTagRenderer();
  private activeScroller: HTMLElement | null = null;
  private routeTimer = 0;
  private activePageToken = '';
  private pendingPageToken = '';

  start(): void {
    this.tags.start();
    const root = document.querySelector(selectors.app) ?? document.body;
    this.observer = new MutationObserver((mutations) => {
      if (
        this.pendingIdentity ||
        mutations.some((mutation) => this.isConversationStructureMutation(mutation))
      ) {
        this.scheduleCheck();
      }
    });
    this.observer.observe(root, { childList: true, characterData: true, subtree: true });
    if (isMetaHost()) {
      // Meta uses pushState and can reuse both the header and message region.
      // Poll only the cheap route token; no extraction/storage/network on polls.
      this.routeTimer = window.setInterval(() => {
        if (pageConversationToken() !== this.activePageToken) this.scheduleCheck(30);
      }, 750);
    }
    this.scheduleCheck(50);
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    window.clearTimeout(this.timer);
    window.clearInterval(this.routeTimer);
    this.switchGeneration += 1;
    this.loader.cancel(false);
    this.liveMessages.stop();
    this.activeScroller = null;
    this.tags.stop();
  }

  getContext(): ActiveContext {
    return {
      available: Object.values(selectorHealth()).every(Boolean),
      conversation: this.pendingIdentity || pageConversationToken() !== this.activePageToken
        ? null : this.activeIdentity,
      capture: this.loader.getState(),
    };
  }

  async startCapture(): Promise<void> {
    const identity = getActiveConversationIdentity();
    if (!identity) throw new Error(getActiveConversationMatchError() ?? '请先选择一个 WhatsApp 会话');
    if (this.pendingIdentity || pageConversationToken() !== this.activePageToken || this.activeIdentity?.id !== identity.id) {
      this.scheduleCheck(50);
      throw new Error('会话正在切换，请稍候再开始读取');
    }
    const settings = await getCaptureSettings();
    this.liveMessages.stop();
    try {
      await this.loader.start(identity, settings);
    } finally {
      const scroller = queryMessageScroller();
      if (
        this.activeIdentity?.id === identity.id &&
        getActiveConversationIdentity()?.id === identity.id &&
        scroller?.isConnected
      ) {
        this.activeScroller = scroller;
        this.liveMessages.start(identity, scroller);
      }
    }
  }

  pauseCapture(): void {
    this.loader.pause();
  }

  cancelCapture(): void {
    this.loader.cancel();
  }

  refreshTags(): void {
    void this.tags.refresh();
  }

  refreshContactMatching(): void {
    this.tags.reconcileVisibleRows();
    this.scheduleCheck(50);
  }

  private scheduleCheck(delay = 250): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.checkConversation(), delay);
  }

  private async checkConversation(): Promise<void> {
    const pageToken = pageConversationToken();
    const identity = getActiveConversationIdentity();
    const main = queryConversationMain();
    const scroller = main ? queryMessageScroller(main) : null;
    if (!identity || !main || !scroller) {
      this.pendingIdentity = null;
      this.pendingSince = 0;
      this.pendingMessageFingerprint = '';
      if (this.activeIdentity) {
        this.switchGeneration += 1;
        this.activeIdentity = null;
        this.activeScroller = null;
        this.liveMessages.stop();
        await this.loader.reset(null, getActiveConversationMatchError() ?? '等待选择会话');
      }
      const matchError = getActiveConversationMatchError();
      if (matchError && this.loader.getState().note !== matchError) await this.loader.reset(null, matchError);
      this.activeMessageFingerprint = '';
      return;
    }
    const messageFingerprint = this.getMessageFingerprint(scroller);
    if (identity.id === this.activeIdentity?.id && pageToken === this.activePageToken) {
      if (
        this.activeScroller !== scroller &&
        this.loader.getState().status !== 'reading'
      ) {
        this.activeScroller = scroller;
        this.liveMessages.start(identity, scroller);
      }
      this.activeMessageFingerprint = messageFingerprint;
      this.pendingIdentity = null;
      this.pendingSince = 0;
      this.pendingMessageFingerprint = '';
      return;
    }

    const now = Date.now();
    if (identity.id !== this.pendingIdentity?.id || pageToken !== this.pendingPageToken) {
      this.liveMessages.stop();
      this.loader.cancel(false);
      this.switchGeneration += 1;
      this.activeScroller = null;
      this.pendingIdentity = identity;
      this.pendingPageToken = pageToken;
      this.pendingSince = now;
      this.pendingMessageFingerprint = messageFingerprint;
      this.scheduleCheck(500);
      return;
    }
    if (
      this.activeIdentity &&
      this.activeMessageFingerprint &&
      messageFingerprint === this.activeMessageFingerprint
    ) {
      this.scheduleCheck(250);
      return;
    }
    if (messageFingerprint !== this.pendingMessageFingerprint) {
      this.pendingMessageFingerprint = messageFingerprint;
      this.pendingSince = now;
      this.scheduleCheck(450);
      return;
    }
    if (now - this.pendingSince < 450) {
      this.scheduleCheck(450 - (now - this.pendingSince));
      return;
    }

    const confirmedIdentity = getActiveConversationIdentity();
    const confirmedMain = queryConversationMain();
    const confirmedScroller = confirmedMain ? queryMessageScroller(confirmedMain) : null;
    if (
      confirmedIdentity?.id !== identity.id ||
      pageConversationToken() !== pageToken ||
      confirmedScroller !== scroller ||
      !scroller.isConnected
    ) {
      this.pendingIdentity = null;
      this.pendingSince = 0;
      this.pendingMessageFingerprint = '';
      this.scheduleCheck(250);
      return;
    }

    const generation = ++this.switchGeneration;
    const resolved = await sendBackground({
      type: 'db:resolve-conversation',
      conversation: identity,
    });
    if (!resolved.ok) {
      this.pendingIdentity = null;
      this.pendingSince = 0;
      this.pendingMessageFingerprint = '';
      this.scheduleCheck(250);
      return;
    }
    if (
      generation !== this.switchGeneration ||
      pageConversationToken() !== pageToken ||
      getActiveConversationIdentity()?.id !== identity.id ||
      queryMessageScroller() !== scroller ||
      !scroller.isConnected
    ) {
      this.scheduleCheck(250);
      return;
    }
    this.activeIdentity = identity;
    this.activePageToken = pageToken;
    this.activeScroller = scroller;
    this.pendingIdentity = null;
    this.pendingSince = 0;
    this.pendingMessageFingerprint = '';
    this.activeMessageFingerprint = messageFingerprint;
    await this.loader.reset(identity);
    if (!this.isCurrentConversation(generation, identity, scroller)) return;
    this.liveMessages.start(identity, scroller);
    this.tags.reconcileVisibleRows();
  }

  private isCurrentConversation(
    generation: number,
    identity: ConversationIdentity,
    scroller: HTMLElement,
  ): boolean {
    return (
      generation === this.switchGeneration &&
      pageConversationToken() === this.activePageToken &&
      this.activeIdentity?.id === identity.id &&
      getActiveConversationIdentity()?.id === identity.id &&
      queryMessageScroller() === scroller &&
      scroller.isConnected
    );
  }

  private getMessageFingerprint(scroller: ParentNode): string {
    const ids = [...scroller.querySelectorAll<HTMLElement>(selectors.messageWrapper)]
      .map((element) => element.dataset.messageId ?? element.dataset.testid ?? element.dataset.id ?? '')
      .filter(Boolean);
    return [...ids.slice(0, 3), ...ids.slice(-3)].join('|');
  }

  private isConversationStructureMutation(mutation: MutationRecord): boolean {
    const target = mutation.target instanceof Element
      ? mutation.target
      : mutation.target.parentElement;
    if (
      target?.matches(selectors.main) ||
      target?.closest(selectors.conversationHeader)
    ) {
      return true;
    }
    return [...mutation.addedNodes, ...mutation.removedNodes].some((node) => {
      if (!(node instanceof Element)) return false;
      return (
        node.matches(selectors.main) ||
        node.matches(selectors.conversationHeader) ||
        node.matches(selectors.messageScroller) ||
        Boolean(node.querySelector(selectors.main)) ||
        Boolean(node.querySelector(selectors.conversationHeader)) ||
        Boolean(node.querySelector(selectors.messageScroller))
      );
    });
  }
}

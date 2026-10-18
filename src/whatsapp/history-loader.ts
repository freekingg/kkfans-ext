import { browser } from 'wxt/browser';
import type { BackgroundRequest, BackgroundResponse } from '../core/runtime-messages';
import type { CaptureSettings, CaptureState, ConversationIdentity } from '../core/types';
import { getActiveConversationIdentity } from './conversation-identity';
import { extractVisibleMessages } from './message-extractor';
import { queryMessageScroller, selectors } from './selectors';
import { detectVisibleHistoryStart } from './history-start';
import { pageConversationToken } from '../platforms/page-target';

const EMPTY_STATE: CaptureState = {
  status: 'idle',
  conversationId: null,
  title: null,
  captured: 0,
  rounds: 0,
  startedAt: null,
  updatedAt: Date.now(),
  note: '等待选择会话',
};

async function sendBackground(request: BackgroundRequest): Promise<BackgroundResponse> {
  return (await browser.runtime.sendMessage(request)) as BackgroundResponse;
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = window.setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

function firstMessageId(scroller: ParentNode): string | null {
  const element = scroller.querySelector<HTMLElement>(selectors.messageWrapper);
  return element?.dataset.messageId ?? element?.dataset.testid ?? null;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export class HistoryLoader {
  private state: CaptureState = EMPTY_STATE;
  private controller: AbortController | null = null;
  private activeConversation: ConversationIdentity | null = null;
  private restoreViewport: (() => void) | null = null;
  private generation = 0;
  private pageToken = '';

  getState(): CaptureState {
    return this.state;
  }

  async reset(
    identity: ConversationIdentity | null,
    note = identity ? '已启用自动增量捕获；需要更早消息时点击“补齐历史”' : '等待选择会话',
  ): Promise<void> {
    this.cancel(false);
    this.activeConversation = identity;
    await this.publish({
      status: 'idle',
      conversationId: identity?.id ?? null,
      title: identity?.title ?? null,
      captured: 0,
      rounds: 0,
      startedAt: null,
      updatedAt: Date.now(),
      note,
    });
  }

  async start(identity: ConversationIdentity, settings: CaptureSettings): Promise<void> {
    if (this.state.status === 'reading' && this.activeConversation?.id === identity.id) return;
    this.cancel(false);
    const generation = this.generation;
    this.pageToken = pageConversationToken();

    const knownResponse = await sendBackground({
      type: 'db:list-message-keys',
      conversationId: identity.id,
    });
    if (
      generation !== this.generation ||
      pageConversationToken() !== this.pageToken ||
      getActiveConversationIdentity()?.id !== identity.id
    ) return;
    if (!knownResponse.ok || !('messageKeys' in knownResponse)) {
      await this.publish({
        status: 'error',
        conversationId: identity.id,
        title: identity.title,
        captured: 0,
        rounds: 0,
        startedAt: Date.now(),
        updatedAt: Date.now(),
        note: knownResponse.ok ? '无法读取本地消息索引' : knownResponse.error,
      }, generation);
      return;
    }
    const knownKeys = new Set(knownResponse.messageKeys);
    const incremental = knownKeys.size > 0;

    const scroller = queryMessageScroller();
    if (!scroller) {
      await this.publish({
        status: 'error',
        conversationId: identity.id,
        title: identity.title,
        captured: 0,
        rounds: 0,
        startedAt: Date.now(),
        updatedAt: Date.now(),
        note: '未找到消息滚动区域，可能是 WhatsApp 页面结构已更新',
      }, generation);
      return;
    }

    this.activeConversation = identity;
    this.controller = new AbortController();
    const { signal } = this.controller;
    const originalBottomDistance = Math.max(
      0,
      scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop,
    );
    const originallyNearBottom = originalBottomDistance < 120;
    this.restoreViewport = () => {
      if (!scroller.isConnected || queryMessageScroller() !== scroller) return;
      scroller.scrollTop = originallyNearBottom
        ? scroller.scrollHeight
        : Math.max(0, scroller.scrollHeight - scroller.clientHeight - originalBottomDistance);
    };

    const main = document.querySelector(selectors.main);
    const pauseForUserInput = (event: Event) => {
      if (!event.isTrusted || !main?.contains(event.target as Node)) return;
      this.pause('检测到手动操作，已暂停采集');
    };
    main?.addEventListener('wheel', pauseForUserInput, { capture: true, passive: true });
    main?.addEventListener('pointerdown', pauseForUserInput, { capture: true, passive: true });

    await this.publish({
      status: 'reading',
      conversationId: identity.id,
      title: identity.title,
      captured: 0,
      rounds: 0,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      note: incremental ? '正在补齐更早的历史消息…' : '正在读取历史消息…',
    }, generation);

    try {
      const initial = await this.persistVisible(identity, scroller, signal, knownKeys);
      if (generation !== this.generation) throw new DOMException('Aborted', 'AbortError');
      let addedThisRun = initial.added;
      let noGrowthRounds = 0;

      for (let round = 1; round <= settings.maxRounds; round += 1) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const currentScroller = queryMessageScroller();
        if (!currentScroller) throw new Error('消息滚动区域已消失');

        const beforeHeight = currentScroller.scrollHeight;
        if (pageConversationToken() !== this.pageToken || getActiveConversationIdentity()?.id !== identity.id) {
          throw new DOMException('Aborted', 'AbortError');
        }
        const beforeFirstId = firstMessageId(currentScroller);
        currentScroller.scrollTop = 0;
        await this.waitForHistoryMutation(currentScroller, settings.settleMs, signal);
        const persisted = await this.persistVisible(identity, currentScroller, signal, knownKeys);
        addedThisRun += persisted.added;
        const afterHeight = currentScroller.scrollHeight;
        const afterFirstId = firstMessageId(currentScroller);
        const grew = persisted.added > 0 || afterHeight > beforeHeight || afterFirstId !== beforeFirstId;
        noGrowthRounds = grew ? 0 : noGrowthRounds + 1;

        await this.publish({
          ...this.state,
          status: 'reading',
          captured: persisted.total,
          rounds: round,
          updatedAt: Date.now(),
          note: incremental
            ? `已补充 ${addedThisRun} 条，继续加载更早消息…`
            : (grew ? `已读取 ${persisted.total} 条，继续加载更早消息…` : '正在确认是否已到最早消息…'),
        }, generation);

        if (noGrowthRounds >= 3) {
          if (signal.aborted || generation !== this.generation ||
            queryMessageScroller() !== currentScroller || getActiveConversationIdentity()?.id !== identity.id) {
            throw new DOMException('Aborted', 'AbortError');
          }
          const historyStart = detectVisibleHistoryStart(currentScroller, extractVisibleMessages(identity.id, currentScroller));
          if (historyStart) {
            const result = await sendBackground({ type: 'db:set-history-start', conversationId: identity.id, historyStart });
            if (!result.ok) throw new Error(result.error);
            if (signal.aborted || generation !== this.generation || getActiveConversationIdentity()?.id !== identity.id) {
              throw new DOMException('Aborted', 'AbortError');
            }
          }
          await this.publish({
            ...this.state,
            status: 'complete',
            captured: persisted.total,
            rounds: round,
            updatedAt: Date.now(),
            note: historyStart
              ? `已读到当前设备最早可见消息，本次新增 ${addedThisRun} 条`
              : `暂未加载到更早消息，本次新增 ${addedThisRun} 条；首聊仍待确认，可稍后重试`,
          }, generation);
          return;
        }
      }

      await this.publish({
        ...this.state,
        status: 'complete',
        updatedAt: Date.now(),
        note: incremental
          ? `已达到安全轮次上限，本次补充 ${addedThisRun} 条`
          : '已达到安全轮次上限',
      }, generation);
    } catch (error) {
      if (isAbortError(error)) return;
      await this.publish({
        ...this.state,
        status: 'error',
        updatedAt: Date.now(),
        note: error instanceof Error ? error.message : '采集失败',
      }, generation);
    } finally {
      main?.removeEventListener('wheel', pauseForUserInput, true);
      main?.removeEventListener('pointerdown', pauseForUserInput, true);
      this.restoreViewport?.();
      this.restoreViewport = null;
      if (generation === this.generation) this.controller = null;
    }
  }

  pause(note = '采集已暂停'): void {
    if (this.state.status !== 'reading') return;
    this.controller?.abort();
    this.controller = null;
    this.generation += 1;
    void this.publish({ ...this.state, status: 'paused', updatedAt: Date.now(), note });
  }

  cancel(publish = true): void {
    const wasReading = this.state.status === 'reading';
    this.controller?.abort();
    this.controller = null;
    this.generation += 1;
    this.restoreViewport?.();
    this.restoreViewport = null;
    if (publish && wasReading) {
      void this.publish({
        ...this.state,
        status: 'cancelled',
        updatedAt: Date.now(),
        note: '采集已取消',
      });
    }
  }

  private async persistVisible(
    identity: ConversationIdentity,
    scroller: HTMLElement,
    signal: AbortSignal,
    knownKeys: ReadonlySet<string>,
  ): Promise<{ added: number; total: number; hasKnownMessage: boolean }> {
    if (
      signal.aborted ||
      pageConversationToken() !== this.pageToken ||
      !scroller.isConnected ||
      queryMessageScroller() !== scroller ||
      getActiveConversationIdentity()?.id !== identity.id
    ) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const messages = extractVisibleMessages(identity.id, scroller);
    const hasKnownMessage = messages.some((message) => knownKeys.has(message.key));
    if (signal.aborted || pageConversationToken() !== this.pageToken || getActiveConversationIdentity()?.id !== identity.id) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const response = await sendBackground({
      type: 'db:upsert-messages',
      conversation: identity,
      messages,
    });
    if (
      signal.aborted ||
      queryMessageScroller() !== scroller ||
      getActiveConversationIdentity()?.id !== identity.id
    ) {
      throw new DOMException('Aborted', 'AbortError');
    }
    if (!response.ok || !('added' in response)) {
      throw new Error(response.ok ? '保存消息失败' : response.error);
    }
    return { added: response.added, total: response.total, hasKnownMessage };
  }

  private waitForHistoryMutation(
    scroller: HTMLElement,
    settleMs: number,
    signal: AbortSignal,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settledTimer = 0;
      const hardTimer = window.setTimeout(finish, 1800);
      const observer = new MutationObserver(() => {
        window.clearTimeout(settledTimer);
        settledTimer = window.setTimeout(finish, settleMs);
      });

      function cleanup() {
        observer.disconnect();
        window.clearTimeout(hardTimer);
        window.clearTimeout(settledTimer);
        signal.removeEventListener('abort', abort);
      }

      function finish() {
        cleanup();
        resolve();
      }

      function abort() {
        cleanup();
        reject(new DOMException('Aborted', 'AbortError'));
      }

      signal.addEventListener('abort', abort, { once: true });
      observer.observe(scroller, { childList: true, subtree: true });
    }).then(() => delay(Math.min(250, settleMs), signal));
  }

  private async publish(state: CaptureState, generation = this.generation): Promise<void> {
    if (generation !== this.generation) return;
    this.state = state;
    await sendBackground({ type: 'capture:publish-state', state });
  }
}

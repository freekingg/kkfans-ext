import type { ContentCommand, ContentResponse } from '../core/runtime-messages';
import { isContentCommand } from '../core/runtime-messages';
import { ConversationController } from '../content/conversation-controller';
import { getCloudSettings } from '../storage/settings';
import { CONVERSATION_MATCH_INDEX, setConversationMatchIndex, setIdentityUsername, type ConversationMatchIndex } from '../whatsapp/conversation-identity';
import { respondToRuntimeMessage } from '../core/runtime-response';
import { CHAT_PAGE_MATCHES } from '../platforms/page-target';

export default defineContentScript({
  matches: CHAT_PAGE_MATCHES,
  runAt: 'document_idle',
  async main(ctx) {
    const controller = new ConversationController();
    let enabled = false;
    let currentUsername = '';
    let disposed = false;
    let initializationError = '';
    let availabilityTask: Promise<void> | null = null;
    const refreshAvailability = async () => {
      const settings = await getCloudSettings();
      if (disposed) return;
      const nextEnabled = true;
      if (nextEnabled === enabled && currentUsername === settings.username) return;
      if (enabled) controller.stop();
      currentUsername = settings.username;
      setIdentityUsername(settings.username);
      const stored = await browser.storage.local.get(CONVERSATION_MATCH_INDEX);
      if (disposed) return;
      setConversationMatchIndex((stored[CONVERSATION_MATCH_INDEX] ?? null) as ConversationMatchIndex | null);
      if (nextEnabled) controller.start();
      enabled = nextEnabled;
    };
    const initialize = () => {
      if (availabilityTask) return availabilityTask;
      availabilityTask = refreshAvailability().then(() => { initializationError = ''; }).catch((cause: unknown) => {
        enabled = false;
        initializationError = cause instanceof Error ? cause.message : String(cause);
        controller.stop();
      }).finally(() => { availabilityTask = null; });
      return availabilityTask;
    };
    const storageListener = (changes: Record<string, Browser.storage.StorageChange>) => {
      if (changes.cloudSettings) void initialize();
      if (changes[CONVERSATION_MATCH_INDEX]) {
        setConversationMatchIndex((changes[CONVERSATION_MATCH_INDEX].newValue ?? null) as ConversationMatchIndex | null);
        if (enabled) controller.refreshContactMatching();
      }
    };
    browser.storage.onChanged.addListener(storageListener);
    ctx.onInvalidated(() => {
      disposed = true;
      browser.storage.onChanged.removeListener(storageListener);
      controller.stop();
    });

    const listener = (
      message: unknown,
      _sender: Browser.runtime.MessageSender,
      sendResponse: (response: ContentResponse) => void,
    ): true | undefined => {
      if (!isContentCommand(message)) return undefined;
      return respondToRuntimeMessage<ContentResponse>(async () => {
        if (availabilityTask) await availabilityTask;
        else if (initializationError) await initialize();
        if (disposed) return { ok: false, error: '插件已更新，正在重新连接页面' };
        if (initializationError) return { ok: false, error: `WhatsApp 页面脚本初始化失败：${initializationError}` };
        return handleCommand(controller, message, enabled);
      }, sendResponse);
    };
    browser.runtime.onMessage.addListener(listener);
    ctx.onInvalidated(() => browser.runtime.onMessage.removeListener(listener));
    // Register the callback before storage or controller startup can fail.
    // A failed initialization remains reachable and can recover on the next poll.
    await initialize();
  },
});

async function handleCommand(
  controller: ConversationController,
  command: ContentCommand,
  enabled: boolean,
): Promise<ContentResponse> {
  try {
    if (!enabled && command.type !== 'content:get-context') {
      return { ok: false, error: '页面读取尚未就绪，请稍后重试' };
    }
    switch (command.type) {
      case 'content:get-context':
        return { ok: true, context: controller.getContext() };
      case 'content:start-capture':
        await controller.startCapture();
        return { ok: true };
      case 'content:pause-capture':
        controller.pauseCapture();
        return { ok: true };
      case 'content:cancel-capture':
        controller.cancelCapture();
        return { ok: true };
      case 'content:refresh-tags':
        controller.refreshTags();
        return { ok: true };
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '命令执行失败' };
  }
}

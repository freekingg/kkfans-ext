import { browser } from 'wxt/browser';
import type { ContentCommand, ContentResponse } from './runtime-messages';
import { CHAT_PAGE_MATCHES, isChatPage, isMetaHost, isMetaWhatsAppPage } from '../platforms/page-target';

const repairs = new Map<number, Promise<void>>();
const lastRepair = new Map<number, number>();
function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
function noReceiver(cause: unknown): boolean {
  return /Receiving end does not exist|Could not establish connection/i.test(errorText(cause));
}
async function repair(tabId: number): Promise<void> {
  const running = repairs.get(tabId);
  if (running) return running;
  // The panel polls. Do not reinject a broken page on every poll.
  if (Date.now() - (lastRepair.get(tabId) ?? 0) < 15_000) return;
  const task = (async () => {
    lastRepair.set(tabId, Date.now());
    const files = browser.runtime.getManifest().content_scripts
      ?.find(script => script.matches?.includes('https://web.whatsapp.com/*'))?.js;
    if (!files?.some(file => file.replace(/^\//, '') === 'content-scripts/whatsapp.js')) throw new Error('插件包缺少 WhatsApp 页面脚本，请重新加载完整插件目录');
    await browser.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ['/content-scripts/whatsapp.js'] });
  })();
  repairs.set(tabId, task);
  try { await task; } finally { repairs.delete(tabId); }
}

/** Bind the panel to its own window; never operate on a different window's chat. */
export async function sendContent(command: ContentCommand): Promise<ContentResponse> {
  try {
    const tabs = await browser.tabs.query({ url: CHAT_PAGE_MATCHES, currentWindow: true });
    const active = tabs.find(item => item.active);
    if (active?.url && isMetaHost(active.url) && !isMetaWhatsAppPage(active.url)) {
      return { ok: false, error: '请在 Meta 收件箱切换到 WhatsApp 标签页' };
    }
    const supported = tabs.filter(item => !item.url || isChatPage(item.url));
    const tab = supported.find(item => item.active) ?? supported[0];
    if (tab?.id == null) return { ok: false, error: '本窗口没有打开 WhatsApp Web 或 Meta Inbox WhatsApp，请在聊天所在窗口打开插件面板' };
    if (tab.status === 'loading') return { ok: false, error: 'WhatsApp 页面正在加载，完成后将自动连接' };
    let response: ContentResponse | undefined;
    try {
      response = await browser.tabs.sendMessage(tab.id, command, { frameId: 0 }) as ContentResponse | undefined;
    } catch (cause) {
      // Only retry commands that definitely had no receiver. Never repeat a
      // potentially executed capture command after its response channel closed.
      if (!noReceiver(cause)) throw cause;
      await repair(tab.id);
      response = await browser.tabs.sendMessage(tab.id, command, { frameId: 0 }) as ContentResponse | undefined;
    }
    return response && typeof response.ok === 'boolean' ? response
      : { ok: false, error: 'WhatsApp 页面未返回有效响应，请重新加载插件后再刷新页面' };
  } catch (cause) {
    return { ok: false, error: `WhatsApp 页面连接失败：${errorText(cause)}` };
  }
}

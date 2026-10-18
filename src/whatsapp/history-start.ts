import type { ChatMessage } from '../core/types';
import { selectors } from './selectors';
import { isMetaHost } from '../platforms/page-target';

/** Conservative DOM adapter. No-growth, a date divider, or scrollTop=0 alone
 * cannot prove history start. Unknown/new WhatsApp markup stays unconfirmed. */
export function detectVisibleHistoryStart(scroller: HTMLElement, messages: ChatMessage[]) {
  if (isMetaHost()) return null; // Inbox's visible top is not proof of WhatsApp account history start.
  if (scroller.scrollTop > 2 || scroller.querySelector('[role="progressbar"], [aria-busy="true"]')) return null;
  const notice = scroller.querySelector<HTMLElement>('[data-testid="e2e-notification"]');
  const firstWrapper = scroller.querySelector<HTMLElement>(selectors.messageWrapper);
  if (!notice || notice.hidden || notice.closest('[hidden], [aria-hidden="true"]') ||
    notice.closest(selectors.messageWrapper) || !firstWrapper ||
    !(notice.compareDocumentPosition(firstWrapper) & Node.DOCUMENT_POSITION_FOLLOWING)) return null;
  const text = notice.textContent ?? '';
  if (!/end.to.end encrypted|cifrad[oa]s? de extremo a extremo|端到端加密/i.test(text)) return null;
  const first = messages.find((message) => message.kind !== 'system' && message.direction !== 'unknown');
  return first ? { messageId: first.id, detectedAt: Date.now() } : null;
}

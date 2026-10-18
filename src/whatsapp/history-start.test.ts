import { describe, expect, it } from 'vitest';
import { detectVisibleHistoryStart } from './history-start';
import { extractVisibleMessages } from './message-extractor';

const notice = '<div data-testid="e2e-notification">Messages and calls are end-to-end encrypted.</div>';
const message = `<div class="message-in" data-testid="conv-msg-first"><div data-testid="msg-container"><div data-pre-plain-text="[10:00, 29/08/2026] Person: "><span data-testid="selectable-text">Hola</span></div></div></div>`;
function detect(html: string) {
  const scroller = document.createElement('div');
  scroller.innerHTML = html;
  return detectVisibleHistoryStart(scroller, extractVisibleMessages('chat', scroller));
}
describe('Conservative history-start evidence', () => {
  it('recognizes only the explicit notice before actual messages', () => {
    expect(detect(notice + message)?.messageId).toBe('first');
    expect(detect(message + notice)).toBeNull();
    expect(detect(message)).toBeNull();
  });
  it('rejects loading, hidden, and quoted user content as evidence', () => {
    expect(detect(notice + '<div role="progressbar"></div>' + message)).toBeNull();
    expect(detect('<div hidden>' + notice + '</div>' + message)).toBeNull();
    expect(detect(message.replace('Hola', notice))).toBeNull();
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { extractMessage, extractVisibleMessages, parseTimestamp } from './message-extractor';

describe('message-extractor', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('extracts original text and ignores injected translation text', () => {
    document.body.innerHTML = `
      <div data-testid="conv-msg-ABC123" data-id="ABC123">
        <div data-testid="msg-container">
          <span data-icon="tail-out"></span>
          <div data-pre-plain-text="[12:14, 2026/08/29] Me: ">
            <span data-testid="selectable-text">Original Spanish message</span>
            <div style="color:red">第三方翻译内容</div>
          </div>
        </div>
      </div>
    `;
    const container = document.querySelector('[data-testid="msg-container"]')!;
    const message = extractMessage(container, 'chat_test');

    expect(message.id).toBe('ABC123');
    expect(message.text).toBe('Original Spanish message');
    expect(message.text).not.toContain('第三方');
    expect(message.direction).toBe('outgoing');
    expect(message.sender).toBe('Me');
    expect(message.timestampRaw).toBe('12:14, 2026/08/29');
  });

  it('separates quoted text and ignores duplicated link preview text', () => {
    document.body.innerHTML = `
      <div data-testid="conv-msg-QUOTE1">
        <div data-testid="msg-container">
          <span data-icon="tail-in"></span>
          <div data-pre-plain-text="[09:05, 2026/08/29] Partner: ">
            <div data-testid="quoted-message"><span data-testid="selectable-text">Older message</span></div>
            <div data-testid="link-preview-container"><a data-testid="selectable-text" href="https://example.com">Example title</a></div>
            <span data-testid="selectable-text">https://example.com</span>
          </div>
        </div>
      </div>
    `;
    const container = document.querySelector('[data-testid="msg-container"]')!;
    const message = extractMessage(container, 'chat_test');

    expect(message.text).toBe('https://example.com');
    expect(message.quotedText).toBe('Older message');
    expect(message.kind).toBe('link');
    expect(message.urls).toEqual(['https://example.com/']);
  });

  it('extracts all mounted message containers in DOM order', () => {
    document.body.innerHTML = `
      <div id="main">
        <div data-testid="conversation-panel-messages">
          <div data-testid="conv-msg-ONE"><div data-testid="msg-container"><span data-icon="tail-in"></span><div data-pre-plain-text="[1:00] A: "><span data-testid="selectable-text">One</span></div></div></div>
          <div data-testid="conv-msg-TWO"><div data-testid="msg-container"><span data-icon="tail-out"></span><div data-pre-plain-text="[1:01] B: "><span data-testid="selectable-text">Two</span></div></div></div>
        </div>
      </div>
    `;
    const messages = extractVisibleMessages('chat_test');
    expect(messages.map((message) => message.id)).toEqual(['ONE', 'TWO']);
    expect(messages.map((message) => message.domOrder)).toEqual([0, 1]);
  });

  it('never reads stale message containers outside the active scroller', () => {
    document.body.innerHTML = `
      <div data-testid="conversation-panel-messages">
        <div data-testid="conv-msg-CURRENT"><div data-testid="msg-container"><span data-icon="tail-in"></span><div data-pre-plain-text="[10:00, 29/08/2026] Palafox: "><span data-testid="selectable-text">Current</span></div></div></div>
      </div>
      <div aria-hidden="true">
        <div data-testid="conv-msg-STALE"><div data-testid="msg-container"><span data-icon="tail-in"></span><div data-pre-plain-text="[09:00, 29/08/2026] +527296873339: "><span data-testid="selectable-text">Stale</span></div></div></div>
      </div>
    `;

    expect(extractVisibleMessages('chat_palafox').map((message) => message.id)).toEqual(['CURRENT']);
  });

  it('parses common WhatsApp timestamp formats for chronological storage', () => {
    expect(parseTimestamp('16:33, 8/28/2026')).toBe(
      new Date(2026, 7, 28, 16, 33).getTime(),
    );
    expect(parseTimestamp('16:33, 2026年8月28日')).toBe(
      new Date(2026, 7, 28, 16, 33).getTime(),
    );
    expect(parseTimestamp('16:33, 03/08/2026', 'dmy')).toBe(
      new Date(2026, 7, 3, 16, 33).getTime(),
    );
    expect(parseTimestamp('16:33, 2026/08/03')).toBe(
      new Date(2026, 7, 3, 16, 33).getTime(),
    );
  });

  it('uses bubble geometry when grouped messages do not render a tail icon', () => {
    document.body.innerHTML = `
      <div id="main">
        <div data-testid="conv-msg-GROUPED"><div data-testid="msg-container"><div data-pre-plain-text="[12:00] Me: "><span data-testid="selectable-text">Grouped</span></div></div></div>
      </div>
    `;
    const main = document.querySelector('#main')!;
    const container = document.querySelector('[data-testid="msg-container"]')!;
    main.getBoundingClientRect = () => ({ left: 0, width: 1000 } as DOMRect);
    container.getBoundingClientRect = () => ({ left: 700, width: 200 } as DOMRect);
    expect(extractMessage(container, 'chat_test').direction).toBe('outgoing');
  });

  it('prefers WhatsApp message direction classes for grouped bubbles', () => {
    document.body.innerHTML = `
      <div id="main">
        <div class="message-out" data-testid="conv-msg-GROUPED"><div data-testid="msg-container"><div data-pre-plain-text="[12:00] Me: "><span data-testid="selectable-text">Grouped</span></div></div></div>
      </div>
    `;
    const container = document.querySelector('[data-testid="msg-container"]')!;
    expect(extractMessage(container, 'chat_test').direction).toBe('outgoing');
  });
});

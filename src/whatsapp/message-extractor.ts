import type { ChatMessage, MessageDirection, MessageKind } from '../core/types';
import { hashIdentity } from './conversation-identity';
import { queryMessageScroller, selectors } from './selectors';
import { extractMetaMessages } from '../meta-inbox/message-extractor';
import { isMetaHost } from '../platforms/page-target';

type NumericDateOrder = 'dmy' | 'mdy';

let observedNumericDateOrder: NumericDateOrder | null = null;

function isInside(element: Element, selector: string): boolean {
  return Boolean(element.closest(selector));
}

function cleanText(value: string | null | undefined): string {
  return (value ?? '').replace(/\u200e|\u200f/g, '').replace(/\s+/g, ' ').trim();
}

function extractBodyText(container: Element): string {
  const values = [...container.querySelectorAll<HTMLElement>(selectors.selectableText)]
    .filter((element) => !isInside(element, selectors.quotedMessage))
    .filter((element) => !isInside(element, selectors.linkPreview))
    .filter((element) => element.tagName !== 'IMG')
    .map((element) => cleanText(element.innerText || element.textContent))
    .filter(Boolean);

  return [...new Set(values)].join('\n');
}

function extractQuotedText(container: Element): string | null {
  const quote = container.querySelector(selectors.quotedMessage);
  if (!quote) return null;
  const values = [...quote.querySelectorAll<HTMLElement>(selectors.selectableText)]
    .map((element) => cleanText(element.innerText || element.textContent))
    .filter(Boolean);
  return values.at(-1) ?? null;
}

function extractPrePlainText(container: Element): { sender: string | null; timestampRaw: string | null } {
  const raw = container.querySelector<HTMLElement>('[data-pre-plain-text]')?.getAttribute('data-pre-plain-text');
  if (!raw) return { sender: null, timestampRaw: null };
  const match = raw.match(/^\[([^\]]+)]\s*(.*?):\s*$/s);
  if (!match) return { sender: null, timestampRaw: cleanText(raw) || null };
  return {
    timestampRaw: cleanText(match[1]) || null,
    sender: cleanText(match[2]) || null,
  };
}

function extractDirection(container: Element): MessageDirection {
  if (container.closest(selectors.outgoingMessage)) return 'outgoing';
  if (container.closest(selectors.incomingMessage)) return 'incoming';
  if (container.querySelector(selectors.outgoingTail)) return 'outgoing';
  if (container.querySelector(selectors.incomingTail)) return 'incoming';
  const main = container.closest(selectors.main);
  if (main) {
    const bubble = container.closest<HTMLElement>(selectors.messageWrapper) ?? container;
    const wrapperRect = bubble.getBoundingClientRect();
    const bubbleRect = wrapperRect.width > 0 ? wrapperRect : container.getBoundingClientRect();
    const mainRect = main.getBoundingClientRect();
    if (bubbleRect.width > 0 && mainRect.width > 0) {
      const bubbleCenter = bubbleRect.left + bubbleRect.width / 2;
      const mainCenter = mainRect.left + mainRect.width / 2;
      return bubbleCenter > mainCenter ? 'outgoing' : 'incoming';
    }
  }
  return 'unknown';
}

function localeDefaultDateOrder(): NumericDateOrder {
  const locale = document.documentElement.lang || navigator.language || '';
  return /^en-US\b/i.test(locale) ? 'mdy' : 'dmy';
}

function learnNumericDateOrder(timestampRaw: string): NumericDateOrder | null {
  const match = timestampRaw.match(
    /\d{1,2}:\d{2}(?::\d{2})?.*?(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/,
  );
  if (!match) return null;
  const first = Number(match[1]);
  const second = Number(match[2]);
  if (first > 12 && second <= 12) return 'dmy';
  if (second > 12 && first <= 12) return 'mdy';
  return null;
}

export function parseTimestamp(
  timestampRaw: string | null,
  preferredOrder: NumericDateOrder | null = observedNumericDateOrder,
): number | null {
  if (!timestampRaw) return null;
  const chinese = timestampRaw.match(
    /(\d{1,2}):(\d{2})(?::(\d{2}))?.*?(\d{4})年(\d{1,2})月(\d{1,2})日/,
  );
  if (chinese) {
    const [, hour, minute, second = '0', year, month, day] = chinese;
    return new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ).getTime();
  }

  const yearFirst = timestampRaw.match(
    /(\d{1,2}):(\d{2})(?::(\d{2}))?.*?(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/,
  );
  if (yearFirst) {
    const [, hour, minute, second = '0', year, month, day] = yearFirst;
    const result = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ).getTime();
    return Number.isFinite(result) ? result : null;
  }

  const numeric = timestampRaw.match(
    /(\d{1,2}):(\d{2})(?::(\d{2}))?.*?(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/,
  );
  if (!numeric) return null;
  const [, hour, minute, second = '0', first, secondPart, rawYear] = numeric;
  const firstNumber = Number(first);
  const secondNumber = Number(secondPart);
  const year = Number(rawYear) < 100 ? 2000 + Number(rawYear) : Number(rawYear);
  const inferredOrder = learnNumericDateOrder(timestampRaw);
  if (inferredOrder) observedNumericDateOrder = inferredOrder;
  const order = inferredOrder ?? preferredOrder ?? localeDefaultDateOrder();
  const month = order === 'dmy' ? secondNumber : firstNumber;
  const day = order === 'dmy' ? firstNumber : secondNumber;
  const result = new Date(
    year,
    month - 1,
    day,
    Number(hour),
    Number(minute),
    Number(second),
  ).getTime();
  return Number.isFinite(result) ? result : null;
}

function extractUrls(container: Element): string[] {
  const urls = [...container.querySelectorAll<HTMLAnchorElement>('a[href]')]
    .map((anchor) => anchor.href)
    .filter((value) => /^https?:\/\//i.test(value));
  return [...new Set(urls)];
}

function detectKind(container: Element, text: string, urls: string[]): MessageKind {
  const testIds = [...container.querySelectorAll<HTMLElement>('[data-testid]')]
    .map((element) => element.dataset.testid ?? '')
    .join(' ');

  if (/message.*deleted|recalled/i.test(testIds) || /这条消息已删除|message was deleted/i.test(text)) {
    return 'deleted';
  }
  if (container.querySelector('audio') || /audio|voice/i.test(testIds)) return 'audio';
  if (container.querySelector('video') || /video/i.test(testIds)) return 'video';
  if (/document|file/i.test(testIds)) return 'document';
  if (/image|photo|media-viewer/i.test(testIds)) return 'image';
  if (urls.length > 0) return 'link';
  if (text) return 'text';
  return 'unknown';
}

function messageIdFrom(container: Element, fallbackSeed: string): string {
  const wrapper = container.closest<HTMLElement>(selectors.messageWrapper) ??
    container.querySelector<HTMLElement>(selectors.messageWrapper);
  const testId = wrapper?.dataset.testid;
  if (testId?.startsWith('conv-msg-')) return testId.slice('conv-msg-'.length);
  const dataId = wrapper?.dataset.id;
  if (dataId) return dataId;
  return `fallback_${hashIdentity(fallbackSeed)}`;
}

export function extractMessage(
  container: Element,
  conversationId: string,
  domOrder = 0,
  capturedAt = Date.now(),
): ChatMessage {
  const text = extractBodyText(container);
  const quotedText = extractQuotedText(container);
  const urls = extractUrls(container);
  const metadata = extractPrePlainText(container);
  const direction = extractDirection(container);
  const fallbackSeed = `${metadata.timestampRaw ?? ''}\n${metadata.sender ?? ''}\n${text}\n${direction}`;
  const id = messageIdFrom(container, fallbackSeed);

  return {
    key: `${conversationId}:${id}`,
    id,
    conversationId,
    direction,
    kind: detectKind(container, text, urls),
    text,
    quotedText,
    sender: metadata.sender,
    timestampRaw: metadata.timestampRaw,
    timestampMs: parseTimestamp(metadata.timestampRaw),
    urls,
    mediaCount: container.querySelectorAll('img, video, audio').length,
    capturedAt,
    domOrder,
  };
}

export function extractVisibleMessages(
  conversationId: string,
  scroller: ParentNode | null = queryMessageScroller(),
): ChatMessage[] {
  if (!scroller) return [];
  if (isMetaHost()) return extractMetaMessages(conversationId, scroller);
  const capturedAt = Date.now();
  const containers = [...scroller.querySelectorAll(selectors.messageContainers)];
  const learnedOrder = containers
    .map((container) => extractPrePlainText(container).timestampRaw)
    .map((raw) => (raw ? learnNumericDateOrder(raw) : null))
    .find((order): order is NumericDateOrder => Boolean(order));
  if (learnedOrder) observedNumericDateOrder = learnedOrder;
  return containers.map((container, index) =>
    extractMessage(container, conversationId, index, capturedAt),
  );
}

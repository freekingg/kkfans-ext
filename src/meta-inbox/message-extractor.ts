import type { ChatMessage, MessageDirection, MessageKind } from '../core/types';
import { metaSelectors, metaTagPlacement } from './dom';

function clean(value: string): string {
  return value.replace(/[\u200e\u200f\u200b]/g, '').replace(/\s+/g, ' ').trim();
}

/** Only accept an explicit calendar date. No upload-time substitute. */
export function parseMetaTimestamp(raw: string, reference = Date.now()): number | null {
  const match = raw.match(/^(\d{4})[年/.-](\d{1,2})[月/.-](\d{1,2})日?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (match) {
    const [, y, m, d, h, min, s = '0'] = match;
    const value = new Date(+y!, +m! - 1, +d!, +h!, +min!, +s);
    return value.getFullYear() === +y! && value.getMonth() === +m! - 1 && value.getDate() === +d!
      && +h! < 24 && +min! < 60 && +s < 60 ? value.getTime() : null;
  }
  const relative = raw.match(/^(今天|昨天|周[日天一二三四五六]|星期[日天一二三四五六]|Today|Yesterday|Sun(?:day)?|Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?)\s*,?\s*(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
  if (relative) {
    const [, day, hour, minute, period] = relative;
    let h = +hour!;
    if (period) { if (h < 1 || h > 12) return null; h = h % 12 + (/pm/i.test(period) ? 12 : 0); }
    if (h > 23 || +minute! > 59) return null;
    const date = new Date(reference);
    let offset = 0;
    if (/昨天|yesterday/i.test(day!)) offset = 1;
    else if (!/今天|today/i.test(day!)) {
      const zh = '日一二三四五六'.indexOf(day!.at(-1)!.replace('天', '日'));
      const weekday = zh >= 0 ? zh : ['sun','mon','tue','wed','thu','fri','sat'].indexOf(day!.slice(0,3).toLowerCase());
      if (weekday < 0) return null;
      offset = (date.getDay() - weekday + 7) % 7;
    }
    date.setDate(date.getDate() - offset);
    date.setHours(h, +minute!, 0, 0);
    return date.getTime() <= reference + 60_000 ? date.getTime() : null;
  }
  // English locale date separators, e.g. August 21, 2026, 9:30 AM.
  if (/\b\d{4}\b/.test(raw) && /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b/i.test(raw)) {
    const value = Date.parse(raw);
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

export function unwrapMetaUrl(value: string): string | null {
  try {
    let url = new URL(value);
    if (url.hostname === 'l.facebook.com' && url.pathname === '/l.php') {
      const target = url.searchParams.get('u');
      if (!target) return null;
      url = new URL(target);
    }
    if (!/^https?:$/.test(url.protocol)) return null;
    url.searchParams.delete('fbclid');
    return url.href;
  } catch { return null; }
}

function directionOf(element: Element): MessageDirection {
  const column = element.parentElement;
  const row = column?.parentElement;
  if (!column || !row) return 'unknown';
  // Read computed layout, not Meta's generated class names or bubble color.
  const alignment = getComputedStyle(column).alignItems;
  const flow = getComputedStyle(row).flexDirection;
  if (alignment === 'flex-end' && flow === 'row-reverse') return 'outgoing';
  if (alignment === 'flex-start' && flow === 'row') return 'incoming';
  return 'unknown';
}

function bodyText(container: Element): string {
  const visit = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    if (!(node instanceof Element)) return '';
    if (node.matches('button,svg,script,style,[hidden],[aria-hidden="true"],.trans_btn,.trans_result,[data-kkfans-tag-host]')) return '';
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return '';
    if (node.tagName === 'BR') return '\n';
    if (node.tagName === 'IMG') {
      // Emoji-only messages are real messages. Never OCR images/avatars.
      const alt = node.getAttribute('alt') ?? '';
      return /\p{Extended_Pictographic}/u.test(alt) ? alt : '';
    }
    if (node.tagName === 'A') {
      const text = clean(node.textContent ?? '');
      // Meta duplicates a link in its large preview card. Keep the URL label,
      // not the preview article/caption or opaque "Load Media" attachment ID.
      return /^https?:\/\//.test(text) ? text : '';
    }
    return [...node.childNodes].map(visit).join('');
  };
  return visit(container).split('\n').map(clean).filter(Boolean).join('\n');
}

/** Divider timestamps apply to the next message only, not every bubble below.
 * A missing individual time stays unknown instead of inventing a first-chat date. */
function dividerTimes(scroller: ParentNode): Map<Element, string> {
  const values = new Map<Element, string>();
  let pending = '';
  const walk = (node: Element) => {
    if (node.matches('[data-message-id]')) {
      if (pending) values.set(node, pending);
      pending = '';
      return;
    }
    if (!node.children.length) {
      const text = clean(node.textContent ?? '');
      if (parseMetaTimestamp(text) !== null || /^\d{1,2}:\d{2}$/.test(text)) pending = text;
      return;
    }
    for (const child of node.children) walk(child);
  };
  for (const child of scroller.children) walk(child);
  return values;
}

function latestMessageTime(message: ChatMessage, scroller: ParentNode): number | null {
  if (!(scroller instanceof Element)) return null;
  const main = scroller.closest(metaSelectors.main);
  const title = clean(main?.querySelector(metaSelectors.conversationTitle)?.textContent ?? '');
  if (!title || !message.text) return null;
  const row = [...document.querySelectorAll<HTMLElement>(metaSelectors.chatRows)]
    .find(item => clean(item.querySelector(metaSelectors.chatRowTitle)?.textContent ?? '') === title);
  const rowTitle = row?.querySelector<HTMLElement>(metaSelectors.chatRowTitle);
  if (!row || !rowTitle) return null;
  const placement = metaTagPlacement(row, rowTitle);
  const preview = clean(placement?.after.textContent ?? '').replace(/^(?:你|You|Tú):\s*/i, '');
  // Only use the list's latest-message timestamp when its actual preview is
  // exactly the final bubble; older virtualized slices cannot inherit it.
  if (preview !== clean(message.text)) return null;
  const seconds = Number(row.querySelector<HTMLElement>('[data-utime]')?.dataset.utime);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const time = seconds * 1000;
  const clock = message.timestampRaw?.match(/^(\d{1,2}):(\d{2})$/);
  if (!clock) return null;
  const date = new Date(time);
  return date.getHours() === +clock[1]! && date.getMinutes() === +clock[2]! ? time : null;
}

export function extractMetaMessages(conversationId: string, scroller: ParentNode): ChatMessage[] {
  const capturedAt = Date.now();
  const times = dividerTimes(scroller);
  const containers = [...scroller.querySelectorAll<HTMLElement>('[data-message-id]')]
    .filter(el => !el.parentElement?.closest('[data-message-id]'));
  const messages: ChatMessage[] = containers.map((element, domOrder) => {
    const id = `meta:${element.dataset.messageId!}`;
    const text = bodyText(element);
    const urls = [...new Set([...element.querySelectorAll<HTMLAnchorElement>('a[href]')]
      .filter(a => !a.getAttribute('href')?.startsWith('#'))
      .map(a => unwrapMetaUrl(a.href)).filter((url): url is string => Boolean(url)))];
    const imageAttachments = [...element.querySelectorAll('a[aria-label]')]
      .filter(el => /图片附件|image attachment|photo attachment/i.test(el.getAttribute('aria-label') ?? ''));
    const kind: MessageKind = /Message can't be displayed|无法显示此消息/i.test(text) ? 'unknown'
      : element.querySelector('audio') ? 'audio'
      : element.querySelector('video') ? 'video'
      : imageAttachments.length ? 'image'
      : urls.length ? 'link' : text ? 'text' : 'unknown';
    const explicit = element.querySelector<HTMLElement>('time[datetime],[data-utime]');
    const seconds = Number(explicit?.dataset.utime);
    const explicitMs = explicit?.getAttribute('datetime') ? Date.parse(explicit.getAttribute('datetime')!)
      : Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
    const timestampRaw = times.get(element) ?? null;
    return {
      key: `${conversationId}:${id}`, id, conversationId, direction: directionOf(element), kind, text,
      quotedText: null, sender: null, timestampRaw,
      timestampMs: explicitMs != null && Number.isFinite(explicitMs) ? explicitMs : (timestampRaw ? parseMetaTimestamp(timestampRaw) : null),
      urls, mediaCount: imageAttachments.length + element.querySelectorAll('video,audio').length,
      capturedAt, domOrder,
    };
  });
  const last = messages.at(-1);
  if (last && last.timestampMs === null) last.timestampMs = latestMessageTime(last, scroller);
  return messages;
}

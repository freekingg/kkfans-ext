import type { AiProfileSuggestions, ChatMessage } from '../core/types';

const RESERVED_PROFILE_PATHS = new Set([
  'about', 'accounts', 'direct', 'explore', 'p', 'reel', 'reels', 'stories', 'tv',
]);
const CONTENT_PATHS = new Set(['p', 'reel', 'reels', 'tv']);
const MONEY_PATTERN = /(?:\b(?:MXN|USD)\s*\$?\s*[0-9][0-9., ]{0,12}|[0-9][0-9., ]{0,12}\s*(?:MXN|USD|pesos?(?:\s+mexicanos?)?|d[oó]lares?(?:\s+estadounidenses?)?))/giu;
const AGREEMENT_PATTERN = /\b(?:acepto|aceptamos|confirmo|confirmamos|perfecto|trato hecho|me parece bien|est[aá] bien|de acuerdo|dale|okay|ok)\b|(?:同意|确认|接受|成交|就按|没问题|可以|好的?)/iu;
const SHORT_AGREEMENT_PATTERN = /^(?:s[ií]|va|dale|ok(?:ay)?|好的?|可以|没问题)[\s.!¡¿?😊👍]*$/iu;
const NEGOTIATION_PATTERN = /\b(?:muy poco|muy bajo|demasiado bajo|no puedo|no me sirve|contraoferta|subir el precio|m[aá]s dinero)\b|(?:太低|不接受|不行|不能|加价|提高价格|再加)/iu;
const CONDITIONAL_AGREEMENT_PATTERN = /\bsi\b[^.!?]{0,50}\b(?:aceptas|acepta|est[aá]s de acuerdo|te parece bien)\b|如果[^。！？]{0,30}(?:同意|接受|可以)/iu;

function normalizeMoney(raw: string): string | null {
  const number = raw.match(/[0-9][0-9., ]{0,12}/u)?.[0].replace(/\s+/g, '').replace(/[.,]+$/u, '');
  if (!number) return null;
  if (/MXN|MX\$/iu.test(raw) || /pesos?\s+mexicanos?/iu.test(raw)) return `${number} MXN`;
  if (/USD|US\$/iu.test(raw) || /d[oó]lares?(?:\s+estadounidenses?)?/iu.test(raw)) return `${number} USD`;
  if (/pesos?/iu.test(raw)) return `${number} pesos`;
  return null;
}

function moneyValues(text: string): string[] {
  return Array.from(text.matchAll(MONEY_PATTERN), (match) => normalizeMoney(match[0]))
    .filter((value): value is string => Boolean(value));
}

function acceptsPrice(text: string): boolean {
  const normalized = text.trim();
  if (!normalized || NEGOTIATION_PATTERN.test(normalized) || CONDITIONAL_AGREEMENT_PATTERN.test(normalized)) return false;
  return AGREEMENT_PATTERN.test(normalized) || SHORT_AGREEMENT_PATTERN.test(normalized);
}

function extractFinalPrice(messages: ChatMessage[]): string | null {
  let latestCandidate: { value: string; direction: ChatMessage['direction']; index: number } | null = null;
  let finalPrice: string | null = null;

  messages.forEach((message, index) => {
    const values = moneyValues(`${message.quotedText ?? ''}\n${message.text}`);
    const messageAccepts = acceptsPrice(message.text);
    if (messageAccepts && values.length) finalPrice = values.at(-1) ?? finalPrice;
    if (messageAccepts && !values.length && latestCandidate
      && latestCandidate.direction !== message.direction
      && index - latestCandidate.index <= 6) {
      finalPrice = latestCandidate.value;
    }
    const ownValues = moneyValues(message.text);
    if (ownValues.length) {
      latestCandidate = { value: ownValues.at(-1)!, direction: message.direction, index };
    }
  });

  return finalPrice;
}

function instagramUrls(message: ChatMessage): string[] {
  const inline = message.text.match(/https?:\/\/(?:www\.)?instagram\.com\/[^\s<>)]+/gi) ?? [];
  return [...message.urls, ...inline].filter((value, index, values) => values.indexOf(value) === index);
}

function parseInstagramUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    if (!/(^|\.)instagram\.com$/i.test(url.hostname)) return null;
    const segments = url.pathname.split('/').filter(Boolean);
    if (!segments[0]) return null;
    const first = segments[0].toLowerCase();
    const normalizedUrl = `https://www.instagram.com/${segments.join('/')}/`;
    if (CONTENT_PATHS.has(first) && segments[1]) {
      return { kind: 'published' as const, url: normalizedUrl };
    }
    if (RESERVED_PROFILE_PATHS.has(first) || segments.length !== 1) return null;
    return { kind: 'profile' as const, username: segments[0], url: normalizedUrl };
  } catch {
    return null;
  }
}

export function extractProfileSuggestions(messages: ChatMessage[]): Partial<AiProfileSuggestions> {
  let profile: { username: string; url: string } | null = null;
  let publishedUrl: string | null = null;
  for (const message of messages) {
    for (const rawUrl of instagramUrls(message)) {
      const parsed = parseInstagramUrl(rawUrl);
      if (parsed?.kind === 'profile') profile = parsed;
      if (parsed?.kind === 'published') publishedUrl = parsed.url;
    }
  }
  const finalPrice = extractFinalPrice(messages);
  return {
    ...(profile
      ? { instagramUsername: profile.username, instagramProfileUrl: profile.url }
      : {}),
    ...(finalPrice ? { finalPrice } : {}),
    ...(publishedUrl ? { publishedUrl } : {}),
  };
}

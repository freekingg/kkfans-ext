import type { ConversationIdentity } from '../core/types';
import { selectors } from './selectors';
import { isMetaHost, isMetaWhatsAppPage } from '../platforms/page-target';

export function normalizeConversationTitle(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

let identityUsername = '';
export const CONVERSATION_MATCH_INDEX = 'conversationMatchIndex';
export interface ContactMatchRecord { id: string; title: string; contactWhatsapp?: string | undefined }
export interface ConversationMatchIndex { username: string; conversations: ContactMatchRecord[] }
let matchIndex: ConversationMatchIndex | null = null;
let activeMatchError: string | null = null;
let visibleConflicts = new Set<string>();
export const CONTACT_PHONE_SUFFIX_LENGTH = 5;
export function getActiveConversationMatchError(): string | null { return activeMatchError; }
export function setConversationMatchIndex(value: ConversationMatchIndex | null): void { matchIndex = value; }
// Configured once before starting the DOM observers. Never read storage on hover.
export function setIdentityUsername(username: string): void { identityUsername = username.trim(); }

function readElementTitle(element: HTMLElement | null | undefined): string {
  if (!element) return '';
  return (
    element.getAttribute('title') ||
    element.innerText?.trim() ||
    element.textContent?.trim() ||
    ''
  );
}

function normalizeAvatarUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value.split(/[?#]/, 1)[0] ?? value;
  }
}

export function hashIdentity(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

export function normalizeConversationPhone(value: string): string | null {
  if (!/^\+?[\d\s()-]+$/.test(value.trim())) return null;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  // Mexico used to expose mobile numbers as +52 1 + ten digits. WhatsApp now
  // commonly exposes the same contact as +52 + ten digits. Canonicalizing the
  // retired mobile prefix keeps restored cloud aliases, local metadata and the
  // currently visible chat on one identity instead of producing two v2 IDs.
  return /^521\d{10}$/.test(digits) ? `52${digits.slice(3)}` : digits;
}

export function contactPhoneSuffix(value: string): string | null {
  return normalizeConversationPhone(value)?.slice(-CONTACT_PHONE_SUFFIX_LENGTH) ?? null;
}

export function contactMatchKey(record: Pick<ContactMatchRecord, 'title' | 'contactWhatsapp'>): string {
  const phone = normalizeConversationPhone(record.title) ?? normalizeConversationPhone(record.contactWhatsapp ?? '');
  return phone ? `phone:${phone}` : `name:${normalizeConversationTitle(record.title).toLowerCase()}`;
}

export class ContactMatchConflict extends Error {
  constructor(key: string) {
    const phone = key.startsWith('phone:') ? key.slice(6) : '';
    super(`联系人匹配冲突（${phone ? (phone.length === CONTACT_PHONE_SUFFIX_LENGTH ? `号码后 ${CONTACT_PHONE_SUFFIX_LENGTH} 位 ` : '完整号码 ') + phone : key.slice(5)}）：存在多个会话，已停止自动匹配，请先人工核对`);
    this.name = 'ContactMatchConflict';
  }
}

/** Two visible chat rows with different full numbers are positive evidence of
 * ambiguity. Do not attach one person's notes to both rows just by their suffix. */
export function refreshVisibleContactConflicts(): boolean {
  const phones = new Map<string, Set<string>>();
  for (const row of document.querySelectorAll(selectors.chatRows)) {
    const phone = normalizeConversationPhone(readElementTitle(row.querySelector<HTMLElement>(selectors.chatRowTitle)));
    if (!phone) continue;
    const suffix = phone.slice(-CONTACT_PHONE_SUFFIX_LENGTH);
    const values = phones.get(suffix) ?? new Set<string>();
    values.add(phone); phones.set(suffix, values);
  }
  const next = new Set([...phones].filter(([, values]) => values.size > 1).map(([suffix]) => suffix));
  const changed = next.size !== visibleConflicts.size || [...next].some(suffix => !visibleConflicts.has(suffix));
  visibleConflicts = next;
  return changed;
}

/** IDs are opaque and stay unchanged. Prefer an exact normalized number. The
 * last five digits only recover a legacy prefix variant when there is exactly
 * one possible saved contact; a collision creates a distinct full-number ID. */
export function resolveConversationIdentity(
  input: { title: string; avatarKey: string | null; contactWhatsapp?: string | undefined },
  username: string,
  records: ContactMatchRecord[],
): ConversationIdentity | null {
  const identity = identityFromConversationData(input, username);
  if (!identity) return null;
  const phone = normalizeConversationPhone(input.title) ?? normalizeConversationPhone(input.contactWhatsapp ?? '');
  if (phone) {
    const exact = records.filter(record => {
      const candidate = normalizeConversationPhone(record.title) ?? normalizeConversationPhone(record.contactWhatsapp ?? '');
      return candidate === phone;
    });
    const exactIds = [...new Set(exact.map(record => record.id))];
    if (exactIds.length > 1) throw new ContactMatchConflict(`phone:${phone}`);
    if (exactIds.length === 1) return { ...identity, id: exactIds[0]! };

    const suffix = phone.slice(-CONTACT_PHONE_SUFFIX_LENGTH);
    const candidates = records.filter(record =>
      (normalizeConversationPhone(record.title) ?? normalizeConversationPhone(record.contactWhatsapp ?? ''))?.endsWith(suffix));
    const ids = [...new Set(candidates.map(record => record.id))];
    const candidatePhones = new Set(candidates.flatMap(record => {
      const value = normalizeConversationPhone(record.title) ?? normalizeConversationPhone(record.contactWhatsapp ?? '');
      return value ? [value] : [];
    }));
    if (visibleConflicts.has(suffix) || candidatePhones.size > 1) return identity;
    if (ids.length > 1) throw new ContactMatchConflict(`phone:${suffix}`);
    return ids.length ? { ...identity, id: ids[0]! } : identity;
  }

  const key = contactMatchKey(input);
  const candidates = records.filter(record =>
    normalizeConversationTitle(record.title).toLowerCase() === normalizeConversationTitle(input.title).toLowerCase());
  const ids = [...new Set(candidates.map(record => record.id))];
  if (ids.length > 1) throw new ContactMatchConflict(key);
  return ids.length ? { ...identity, id: ids[0]! } : identity;
}

function identityFromTitleAndImage(
  title: string,
  image: HTMLImageElement | null,
  active = false,
): ConversationIdentity | null {
  const input = { title, avatarKey: image?.src ?? null };
  try {
    if (matchIndex?.username !== identityUsername) return identityFromConversationData(input);
    return resolveConversationIdentity(input, identityUsername, matchIndex.conversations);
  } catch (error) {
    if (error instanceof ContactMatchConflict) {
      if (active) activeMatchError = error.message;
      return null;
    }
    throw error;
  }
}

export function identityFromConversationData(input: { title: string; avatarKey: string | null }, username = identityUsername): ConversationIdentity | null {
  const { title } = input;
  const normalizedTitle = normalizeConversationTitle(title);
  if (!normalizedTitle) return null;
  const avatarKey = normalizeAvatarUrl(input.avatarKey);
  const phone = normalizeConversationPhone(normalizedTitle);
  const identitySource = JSON.stringify([username.trim(), phone ? 'phone' : 'name', phone ?? normalizedTitle.toLowerCase()]);
  // A 64-bit ID keeps the synchronous DOM path lightweight. This is an identity
  // checksum, not authentication. Existing IDs are retained by suffix matching.
  let identityHash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(identitySource)) {
    identityHash = BigInt.asUintN(64, (identityHash ^ BigInt(byte)) * 0x100000001b3n);
  }
  const id = `chat_v2_${identityHash.toString(16).padStart(16, '0')}`;
  return { id, title: normalizedTitle, avatarKey };
}

export function identityFromChatRow(row: Element): ConversationIdentity | null {
  if (isMetaHost() && !isMetaWhatsAppPage()) return null;
  const titleElement = row.querySelector<HTMLElement>(selectors.chatRowTitle);
  const title = readElementTitle(titleElement);
  return identityFromTitleAndImage(title, row.querySelector<HTMLImageElement>('img'));
}

export function getActiveConversationIdentity(): ConversationIdentity | null {
  activeMatchError = null;
  if (isMetaHost() && !isMetaWhatsAppPage()) return null;
  refreshVisibleContactConflicts();
  const main = document.querySelector(selectors.main);
  if (!main) return null;

  const titleElement = main.querySelector<HTMLElement>(selectors.conversationTitle);
  const fallbackTitle = main
    .querySelector<HTMLElement>(`${selectors.conversationHeader} [title]`)
    ?.getAttribute('title');
  const title = readElementTitle(titleElement) || fallbackTitle || '';
  const normalizedTitle = normalizeConversationTitle(title);
  if (!normalizedTitle) return null;

  const matchingRow = [...document.querySelectorAll(selectors.chatRows)].find((row) => {
    const candidate = row.querySelector<HTMLElement>(selectors.chatRowTitle);
    const candidateTitle = readElementTitle(candidate);
    return normalizeConversationTitle(candidateTitle) === normalizedTitle;
  });

  return identityFromTitleAndImage(
    normalizedTitle,
    matchingRow?.querySelector<HTMLImageElement>('img') ??
      main.querySelector<HTMLImageElement>(`${selectors.conversationHeader} img`),
    true,
  );
}

import type { ChatMessage } from '../core/types';

const source = (id: string) => id.startsWith('meta:') ? 'meta' : 'web';
const normalizedText = (value: string) => value.normalize('NFKC').replace(/[\u200e\u200f\u200b]/g, '').replace(/\s+/g, ' ').trim();
function signature(message: ChatMessage): string | null {
  if (!['text', 'link'].includes(message.kind) || !message.text || message.direction === 'unknown') return null;
  return JSON.stringify([message.direction, normalizedText(message.text), normalizedText(message.quotedText ?? '')]);
}
function sameMinute(a: ChatMessage, b: ChatMessage): boolean {
  return a.timestampMs != null && b.timestampMs != null
    && Math.floor(a.timestampMs / 60_000) === Math.floor(b.timestampMs / 60_000);
}

/** Cross-surface IDs differ. Reuse an existing record only with unambiguous
 * evidence, and remember the alternative ID so later partial reads stay stable.
 * Never merge repeated greetings, undated attachments or two same-source IDs. */
export function reconcileMessageSources(existing: ChatMessage[], observed: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  const bySignature = new Map<string, ChatMessage[]>();
  for (const record of existing) {
    for (const id of [record.id, ...(record.sourceAliases ?? [])]) byId.set(id, record);
    const key = signature(record);
    if (key) bySignature.set(key, [...(bySignature.get(key) ?? []), record]);
  }
  const used = new Set<string>();
  const observedCounts = new Map<string, number>();
  for (const message of observed) {
    const key = signature(message);
    if (!key || message.timestampMs == null) continue;
    const timed = `${key}:${Math.floor(message.timestampMs / 60_000)}`;
    observedCounts.set(timed, (observedCounts.get(timed) ?? 0) + 1);
  }
  const matched = observed.map(message => {
    const exact = byId.get(message.id);
    if (exact) { used.add(exact.key); return exact; }
    return null;
  });
  for (let index = 0; index < observed.length; index++) {
    if (matched[index]) continue;
    const message = observed[index]!;
    const key = signature(message);
    if (!key) continue;
    const candidates = (bySignature.get(key) ?? []).filter(record =>
      !used.has(record.key) && source(record.id) !== source(message.id)
      && !(record.sourceAliases ?? []).some(id => source(id) === source(message.id)) && sameMinute(record, message));
    // Also require uniqueness on the observed side; a duplicate minute/text is
    // not enough evidence to decide which occurrence belongs to which ID.
    const peers = message.timestampMs == null ? 0 : observedCounts.get(`${key}:${Math.floor(message.timestampMs / 60_000)}`);
    if (candidates.length === 1 && peers === 1) {
      matched[index] = candidates[0]!;
      used.add(candidates[0]!.key);
    }
  }
  // An undated text between two matched, consecutive neighbors is safe to map.
  const ordered = [...existing].sort((a, b) => (a.orderIndex ?? a.domOrder) - (b.orderIndex ?? b.domOrder));
  for (let i = 1; i < observed.length - 1; i++) {
    if (matched[i] || !matched[i - 1] || !matched[i + 1]) continue;
    const left = ordered.findIndex(record => record.key === matched[i - 1]!.key);
    const candidate = ordered[left + 1];
    const message = observed[i]!;
    if (left < 0 || !candidate || ordered[left + 2]?.key !== matched[i + 1]!.key || used.has(candidate.key)) continue;
    if (source(candidate.id) === source(message.id) || !signature(message) || signature(candidate) !== signature(message)) continue;
    if (candidate.timestampMs != null && message.timestampMs != null && !sameMinute(candidate, message)) continue;
    matched[i] = candidate;
    used.add(candidate.key);
  }
  return observed.map((message, index) => {
    const previous = matched[index];
    if (!previous) return message;
    const aliases = [...new Set([...(previous.sourceAliases ?? []), ...(message.sourceAliases ?? []), message.id])]
      .filter(id => id !== previous.id);
    // Same-source rereads can represent genuine edits. Cross-source matches
    // retain the original body/date instead of bouncing between render formats.
    return message.id === previous.id ? {
      ...message, sourceAliases: aliases,
      // Virtualized Meta slices may no longer contain the divider. A later
      // partial read must never erase the date already captured for this ID.
      ...(source(message.id) === 'meta' && message.timestampMs == null && previous.timestampMs != null
        ? { timestampMs: previous.timestampMs, timestampRaw: previous.timestampRaw } : {}),
    }
      : { ...previous, sourceAliases: aliases };
  });
}

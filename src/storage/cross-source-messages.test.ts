import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../core/types';
import { reconcileMessageSources } from './cross-source-messages';
const message = (id: string, text = 'hola', timestampMs: number | null = 120000): ChatMessage => ({
  id, key: `a:${id}`, conversationId: 'a', text, timestampMs, timestampRaw: null,
  direction: 'incoming', kind: 'text', sender: null, quotedText: null, urls: [], mediaCount: 0, capturedAt: 1, domOrder: 0,
});
describe('cross-source message aliases', () => {
  it('reuses a cloud message without dirtying it; remembers the alternative ID', () => {
    const merged = reconcileMessageSources([{ ...message('web-id'), cloudSynced: true }], [message('meta:one')]);
    expect(merged[0]).toMatchObject({ id: 'web-id', cloudSynced: true, sourceAliases: ['meta:one'] });
    expect(reconcileMessageSources(merged, [message('meta:one', 'hola', null)])[0]?.id).toBe('web-id');
  });
  it('never collapses same-source messages, ambiguous duplicates or undated greetings', () => {
    expect(reconcileMessageSources([message('one')], [message('two')])[0]?.id).toBe('two');
    expect(reconcileMessageSources([message('one'), message('two')], [message('meta:x')])[0]?.id).toBe('meta:x');
    expect(reconcileMessageSources([message('one')], [message('meta:x'), message('meta:y')]).map(m => m.id)).toEqual(['meta:x', 'meta:y']);
    expect(reconcileMessageSources([message('one')], [message('meta:x', 'hola', null)])[0]?.id).toBe('meta:x');
  });
  it('matches undated text only between two matched consecutive neighbors', () => {
    const existing = [message('a', 'first'), message('b', 'middle'), message('c', 'last')].map((m, i) => ({ ...m, orderIndex: i * 1024 }));
    expect(reconcileMessageSources(existing, [message('meta:a', 'first'), message('meta:b', 'middle', null), message('meta:c', 'last')]).map(m => m.id)).toEqual(['a', 'b', 'c']);
  });
  it('preserves edits and aliases for the original source', () => {
    expect(reconcileMessageSources([{ ...message('a'), sourceAliases: ['meta:a'] }], [message('a', 'edited')])[0])
      .toMatchObject({ text: 'edited', sourceAliases: ['meta:a'] });
  });
  it('retains a known Meta timestamp when its divider has scrolled out of the DOM', () => {
    expect(reconcileMessageSources([message('meta:a')], [message('meta:a', 'hola', null)])[0]?.timestampMs).toBe(120000);
  });
});

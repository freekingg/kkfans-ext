import { describe, expect, it } from 'vitest';
import { normalizeAiChatTurns } from './ai-chat-store';

describe('AI chat store', () => {
  it('只保留有效的最近40条问答并清理空白', () => {
    const turns = Array.from({ length: 45 }, (_, index) => ({
      id: `turn-${index}`,
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      content: ` answer ${index} `,
      createdAt: new Date(index).toISOString(),
    }));
    const normalized = normalizeAiChatTurns([...turns, { broken: true }]);
    expect(normalized).toHaveLength(40);
    expect(normalized[0]?.id).toBe('turn-5');
    expect(normalized.at(-1)?.content).toBe('answer 44');
  });
});

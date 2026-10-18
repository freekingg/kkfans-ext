import { beforeEach, describe, expect, it, vi } from 'vitest';

const { store } = vi.hoisted(() => ({ store: {} as Record<string, unknown> }));

vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: store[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => Object.assign(store, values)),
      },
    },
  },
}));

import {
  addTranslationHistory,
  deleteTranslationHistory,
  getTranslationHistory,
} from './translation-history';

describe('translation history', () => {
  beforeEach(() => {
    Object.keys(store).forEach((key) => delete store[key]);
  });

  it('keeps the newest 50 translations and supports individual deletion', async () => {
    for (let index = 0; index < 52; index += 1) {
      await addTranslationHistory({
        source: 'zh-CN',
        target: 'es',
        input: `原文 ${index}`,
        output: `Traducción ${index}`,
      });
    }
    const history = await getTranslationHistory();
    expect(history).toHaveLength(50);
    expect(history[0]?.input).toBe('原文 51');
    expect(history.some((entry) => entry.input === '原文 0')).toBe(false);

    const removedId = history[0]!.id;
    await expect(deleteTranslationHistory(removedId)).resolves.toHaveLength(49);
    expect((await getTranslationHistory()).some((entry) => entry.id === removedId)).toBe(false);
  });
});

import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('wxt/browser', () => ({ browser: {} }));
import { addTranslationHistory, deleteTranslationHistory, getTranslationHistory } from './translation-history';

beforeEach(() => localStorage.clear());
it('浏览器预览可本地保存、读取及删除翻译历史', async () => {
  expect(await getTranslationHistory()).toEqual([]);
  await addTranslationHistory({ source: 'zh-CN', target: 'es', input: '你好', output: 'Hola' });
  const entries = await getTranslationHistory();
  expect(entries[0]?.output).toBe('Hola');
  await deleteTranslationHistory(entries[0]!.id);
  expect(await getTranslationHistory()).toEqual([]);
});

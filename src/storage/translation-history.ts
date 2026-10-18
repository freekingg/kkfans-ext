import { browser } from 'wxt/browser';

const STORAGE_KEY = 'translationHistory';
const MAX_HISTORY = 50;

export interface TranslationHistoryEntry {
  id: string;
  source: 'zh-CN' | 'es';
  target: 'zh-CN' | 'es';
  input: string;
  output: string;
  createdAt: number;
}

function isHistoryEntry(value: unknown): value is TranslationHistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<TranslationHistoryEntry>;
  return (
    typeof entry.id === 'string' &&
    (entry.source === 'zh-CN' || entry.source === 'es') &&
    (entry.target === 'zh-CN' || entry.target === 'es') &&
    entry.source !== entry.target &&
    typeof entry.input === 'string' &&
    typeof entry.output === 'string' &&
    Number.isFinite(entry.createdAt)
  );
}

function normalizeHistory(value: unknown): TranslationHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isHistoryEntry)
    .map((entry) => ({
      ...entry,
      input: entry.input.trim().slice(0, 10_000),
      output: entry.output.trim().slice(0, 10_000),
    }))
    .filter((entry) => entry.input && entry.output)
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, MAX_HISTORY);
}

export async function getTranslationHistory(): Promise<TranslationHistoryEntry[]> {
  if (!browser.storage?.local) {
    try { return normalizeHistory(JSON.parse(localStorage.getItem('kkfans-preview-translation-history') ?? '[]')); }
    catch { return []; }
  }
  const stored = await browser.storage.local.get(STORAGE_KEY);
  return normalizeHistory(stored[STORAGE_KEY]);
}

export async function addTranslationHistory(
  value: Omit<TranslationHistoryEntry, 'id' | 'createdAt'>,
): Promise<TranslationHistoryEntry[]> {
  const history = await getTranslationHistory();
  const entry: TranslationHistoryEntry = {
    ...value,
    id: crypto.randomUUID(),
    input: value.input.trim(),
    output: value.output.trim(),
    createdAt: Date.now(),
  };
  const next = [entry, ...history].slice(0, MAX_HISTORY);
  await writeHistory(next);
  return next;
}

export async function deleteTranslationHistory(id: string): Promise<TranslationHistoryEntry[]> {
  const next = (await getTranslationHistory()).filter((entry) => entry.id !== id);
  await writeHistory(next);
  return next;
}

async function writeHistory(entries: TranslationHistoryEntry[]): Promise<void> {
  if (browser.storage?.local) await browser.storage.local.set({ [STORAGE_KEY]: entries });
  else localStorage.setItem('kkfans-preview-translation-history', JSON.stringify(entries));
}

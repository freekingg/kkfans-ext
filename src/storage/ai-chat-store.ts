import { browser } from 'wxt/browser';
import type { AiChatTurn } from '../core/types';

const STORAGE_KEY = 'aiChatSessions';
const MAX_TURNS_PER_CONVERSATION = 40;

type AiChatSessionMap = Record<string, AiChatTurn[]>;

function isAiChatTurn(value: unknown): value is AiChatTurn {
  if (!value || typeof value !== 'object') return false;
  const turn = value as Partial<AiChatTurn>;
  return (
    typeof turn.id === 'string'
    && (turn.role === 'user' || turn.role === 'assistant')
    && typeof turn.content === 'string'
    && typeof turn.createdAt === 'string'
  );
}

export function normalizeAiChatTurns(value: unknown): AiChatTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isAiChatTurn)
    .map((turn) => ({ ...turn, content: turn.content.trim() }))
    .filter((turn) => turn.content)
    .slice(-MAX_TURNS_PER_CONVERSATION);
}

async function getSessionMap(): Promise<AiChatSessionMap> {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  const value = stored[STORAGE_KEY];
  return value && typeof value === 'object' ? (value as AiChatSessionMap) : {};
}

export async function getAiChatTurns(conversationId: string): Promise<AiChatTurn[]> {
  const sessions = await getSessionMap();
  return normalizeAiChatTurns(sessions[conversationId]);
}

export async function saveAiChatTurns(conversationId: string, turns: AiChatTurn[]): Promise<void> {
  const sessions = await getSessionMap();
  sessions[conversationId] = normalizeAiChatTurns(turns);
  await browser.storage.local.set({ [STORAGE_KEY]: sessions });
}

export async function mergeAiChatSessionAliases(
  conversationId: string,
  aliasIds: string[],
): Promise<void> {
  const aliases = [...new Set(aliasIds)].filter((aliasId) => aliasId !== conversationId);
  if (!aliases.length) return;
  const sessions = await getSessionMap();
  const turnById = new Map<string, AiChatTurn>();
  for (const sourceId of [conversationId, ...aliases]) {
    for (const turn of normalizeAiChatTurns(sessions[sourceId])) {
      turnById.set(turn.id, turn);
    }
  }
  const merged = [...turnById.values()]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(-MAX_TURNS_PER_CONVERSATION);
  if (merged.length) sessions[conversationId] = merged;
  else delete sessions[conversationId];
  aliases.forEach((aliasId) => delete sessions[aliasId]);
  await browser.storage.local.set({ [STORAGE_KEY]: sessions });
}

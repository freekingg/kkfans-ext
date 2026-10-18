import { browser } from 'wxt/browser';
import type { CloudSettings, ConversationIdentity } from '../core/types';
import { identityFromConversationData, normalizeConversationPhone } from '../whatsapp/conversation-identity';
import { acknowledgeCloudMessages, listAllMessages, listConversations, mergeConversationAliases } from '../storage/message-db';
import { mergeConversationStorageAliases } from '../storage/settings';
import { mergeAiChatSessionAliases } from '../storage/ai-chat-store';
import { migrateCloudAliases } from './cloud-recovery';
import { assertCloudSpace, cloudSpaceKey } from './cloud-space';
import { CLOUD_SYNC_CURSOR_KEY } from './config';

const JOURNAL = 'cloudIdentityMigrationPending';
const VERSION = 'cloudIdentityMigrationVersion';
interface MigrationEntry { identity: ConversationIdentity; aliasIds: string[] }

async function preserveUploadProgress(settings: CloudSettings, ids: string[]) {
  const stored = (await browser.storage.local.get(CLOUD_SYNC_CURSOR_KEY))[CLOUD_SYNC_CURSOR_KEY];
  if (!stored || typeof stored !== 'object') return;
  for (const [key, raw] of Object.entries(stored)) {
    let parts: unknown;
    try { parts = JSON.parse(key); } catch { continue; }
    if (!Array.isArray(parts) || parts.length !== 3 || parts[0] !== settings.username.trim() ||
      typeof parts[1] !== 'string' || parts[1].replace(/\D/g, '') !== settings.whatsappAccount.replace(/\D/g, '') || !ids.includes(parts[2])) continue;
    const cursor = raw as { capturedAt?: number; keys?: string[] } | null;
    if (!cursor || !Number.isFinite(cursor.capturedAt) || !Array.isArray(cursor.keys)) continue;
    const keys = new Set(cursor.keys);
    const acknowledged = (await listAllMessages(parts[2])).filter(message =>
      message.capturedAt < cursor.capturedAt! || (message.capturedAt === cursor.capturedAt && keys.has(message.key)));
    await acknowledgeCloudMessages(acknowledged);
  }
}

/** Upgrade IDs before restoring/uploading. Journal spans IndexedDB + local storage. */
export async function migrateLocalConversationIdentities(settings: CloudSettings): Promise<void> {
  await assertCloudSpace(settings);
  const stored = await browser.storage.local.get([JOURNAL, VERSION]);
  const version = `${cloudSpaceKey(settings)}:v3`;
  async function apply(entry: MigrationEntry) {
    await assertCloudSpace(settings);
    if (entry.aliasIds.length > 1 && !normalizeConversationPhone(entry.identity.title)) {
      throw new Error(`发现多个无号码的同名旧会话“${entry.identity.title}”，请先核对联系人号码，已停止自动合并`);
    }
    await browser.storage.local.set({ [JOURNAL]: entry });
    await preserveUploadProgress(settings, [entry.identity.id, ...entry.aliasIds]);
    const result = await mergeConversationAliases(entry.identity);
    const aliases = await mergeConversationStorageAliases(entry.identity, [...new Set([...entry.aliasIds, ...result.aliasIds])]);
    await migrateCloudAliases(entry.identity.id, aliases);
    await mergeAiChatSessionAliases(entry.identity.id, aliases);
    await browser.storage.local.set({ [JOURNAL]: null });
  }
  if (stored[JOURNAL]) await apply(stored[JOURNAL] as MigrationEntry);
  // Scan on every recovery. A duplicate can appear after an earlier migration
  // when a cloud alias is restored beside a newly captured, differently
  // formatted local title. The scan is cheap and stable IDs are skipped.
  const groups = new Map<string, MigrationEntry>();
  for (const record of await listConversations()) {
    const identity = identityFromConversationData(record, settings.username);
    if (!identity || identity.id === record.id) continue;
    const entry = groups.get(identity.id) ?? { identity, aliasIds: [] };
    entry.aliasIds.push(record.id);
    groups.set(identity.id, entry);
  }
  for (const entry of groups.values()) await apply(entry);
  await browser.storage.local.set({ [VERSION]: version });
}

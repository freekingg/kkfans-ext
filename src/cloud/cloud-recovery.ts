import { browser } from 'wxt/browser';
import { migrateReportAliases } from './report-policy';
import type { ChatMessage, CloudSettings, ConversationRecord } from '../core/types';
import { importCloudConversations, importCloudMessages, listConversations } from '../storage/message-db';
import {
  getConversationTags, getConversationNotes, getCooperationProfiles, getConversationSopStages,
  getConversationSopStageHistory, getTagDefinitions, normalizeCooperationProfile, hasCooperationProfileData,
} from '../storage/settings';
import { contactMatchKey, ContactMatchConflict, resolveConversationIdentity, type ContactMatchRecord } from '../whatsapp/conversation-identity';
import { publishConversationMatchIndex } from '../storage/conversation-match-index';
import { downloadCloudPage, type CloudConversation } from './cloud-client';
import { assertCloudSpace } from './cloud-space';
import { mergeCloudMetadata, METADATA_FIELDS, sameValue, type CloudMetadata } from './cloud-merge';

export interface CloudBaseline {
  revision: number;
  serverId: string;
  value: CloudMetadata;
  historyStart?: ConversationRecord['historyStart'];
  messageCount?: number;
}
export type BaselineMap = Record<string, CloudBaseline>;
interface Conflict { remote: CloudBaseline; fields: string[] }
interface RecoveryState {
  schemaVersion?: number;
  since?: number;
  lastPullAt?: number;
  aliases?: Record<string, string>;
  resume?: {
    resource: 'conversations' | 'messages'; after?: string; since: number; fullMetadata?: boolean;
    watermark?: number; conversations: number; messages: number; remoteConversationIds?: string[];
  };
}
export const CLOUD_BASELINES = 'cloudMetadataBaselines';
export const CLOUD_CONFLICTS = 'cloudMetadataConflicts';
export const CLOUD_RECOVERY = 'cloudRecoveryState';
export const CLOUD_APPLIED = 'cloudRestoreApplied';
export const CLOUD_SKIPPED = 'cloudSkippedConversations';
export type SkippedConversationMap = Record<string, { serverId: string; revision: number; title: string; reason: 'deleted' }>;

export async function readLocalMetadata(id: string): Promise<CloudMetadata> {
  const [tags, notes, profiles, stages] = await Promise.all([getConversationTags(), getConversationNotes(), getCooperationProfiles(), getConversationSopStages()]);
  return { tagIds: tags[id] ?? [], note: notes[id] ?? null, profile: profiles[id] ?? null, sopStage: stages[id] ?? null };
}

export async function readCloudBaselines(): Promise<BaselineMap> {
  return ((await browser.storage.local.get(CLOUD_BASELINES))[CLOUD_BASELINES] ?? {}) as BaselineMap;
}

export async function saveCloudBaseline(id: string, baseline: CloudBaseline): Promise<void> {
  const values = await readCloudBaselines();
  await browser.storage.local.set({ [CLOUD_BASELINES]: { ...values, [id]: baseline } });
}

function metadata(remote: CloudConversation): CloudMetadata {
  const profile = remote.profile ? normalizeCooperationProfile(remote.profile) : null;
  return { tagIds: remote.tagIds.filter(id => id !== 'partnered'), note: remote.note,
    profile: profile && hasCooperationProfileData(profile) ? profile : null, sopStage: remote.sopStage };
}

async function applyConversations(settings: CloudSettings, records: CloudConversation[], aliases: Record<string, string>) {
  const [tags, notes, profiles, stages, history, bases, stored] = await Promise.all([
    getConversationTags(), getConversationNotes(), getCooperationProfiles(), getConversationSopStages(),
    getConversationSopStageHistory(), readCloudBaselines(), browser.storage.local.get([CLOUD_CONFLICTS, CLOUD_SKIPPED]),
  ]);
  const conflicts = (stored[CLOUD_CONFLICTS] ?? {}) as Record<string, Conflict>;
  const skipped = (stored[CLOUD_SKIPPED] ?? {}) as SkippedConversationMap;
  const histories = new Map(history.map(e => [`${e.conversationId}:${e.eventId}`, e]));
  const conversations: ConversationRecord[] = [];
  const known: ContactMatchRecord[] = (await listConversations()).map(record => ({
    id: record.id, title: record.title, contactWhatsapp: profiles[record.id]?.contactWhatsapp,
  }));
  // Validate the whole page before writes. Different cloud record IDs sharing a
  // suffix must not overwrite one another's baseline, notes, or message aliases.
  const pageKeys = new Map<string, string>();
  for (const remote of records) {
    if (!remote || typeof remote.title !== 'string') throw new Error('云端会话数据格式不正确，恢复未完成');
    const key = contactMatchKey({ title: remote.title, contactWhatsapp: remote.profile?.contactWhatsapp });
    const previous = pageKeys.get(key);
    if (previous && previous !== remote.id) throw new ContactMatchConflict(key);
    pageKeys.set(key, remote.id);
  }
  for (const remote of records) {
    if (!remote || typeof remote.id !== 'string' || typeof remote.title !== 'string' || !Number.isSafeInteger(remote.revision) ||
      !Number.isFinite(remote.createdAt) || !Number.isFinite(remote.updatedAt) || !Array.isArray(remote.tagIds) || !Array.isArray(remote.sopStageHistory)) {
      throw new Error('云端会话数据格式不正确，恢复未完成');
    }
    const source = { ...remote, contactWhatsapp: remote.profile?.contactWhatsapp };
    // A local ID already claimed by a different cloud record cannot be reused
    // by a later same-suffix record. Unclaimed legacy local rows may still use
    // the unique last-five fallback to survive country-prefix formatting changes.
    const claimedByOtherRemote = new Set(Object.entries(aliases)
      .filter(([serverId]) => serverId !== remote.id)
      .map(([, localId]) => localId));
    const identity = resolveConversationIdentity(
      source,
      settings.username,
      known.filter(record => !claimedByOtherRemote.has(record.id)),
    );
    if (!identity) throw new Error('云端会话身份无效');
    const id = identity.id;
    if (bases[id] && bases[id].serverId !== remote.id) throw new ContactMatchConflict(contactMatchKey(source));
    // If a cloud administrator restored the contact, allow it to sync again.
    delete skipped[id];
    aliases[remote.id] = id;
    const local = { tagIds: tags[id] ?? [], note: notes[id] ?? null, profile: profiles[id] ?? null, sopStage: stages[id] ?? null };
    const value = metadata(remote);
    const merged = mergeCloudMetadata(local, value, bases[id]?.value);
    tags[id] = merged.value.tagIds;
    if (merged.value.note) notes[id] = merged.value.note; else delete notes[id];
    if (merged.value.profile) profiles[id] = merged.value.profile; else delete profiles[id];
    if (merged.value.sopStage) stages[id] = merged.value.sopStage; else delete stages[id];
    const nextBase = {
      revision: remote.revision,
      serverId: remote.id,
      value,
      historyStart: remote.historyStart,
      messageCount: remote.messageCount,
    };
    if (merged.conflicts.length) conflicts[id] = { remote: nextBase, fields: merged.conflicts };
    else if (conflicts[id]) {
      // Keep an unresolved conflict until the user chooses, even on an identical retry.
      conflicts[id] = { ...conflicts[id], remote: nextBase };
    }
    bases[id] = nextBase;
    for (const event of remote.sopStageHistory) {
      const key = `${id}:${event.eventId}`;
      const old = histories.get(key);
      if (!old || old.changedAt < event.changedAt) histories.set(key, { ...event, conversationId: id });
    }
    const { tagIds: _tags, note: _note, profile: _profile, sopStage: _stage, sopStageHistory: _history, revision: _revision, ...record } = remote;
    conversations.push({ ...record, id });
    if (!known.some(item => item.id === id)) known.push({ ...source, id });
  }
  await assertCloudSpace(settings);
  await importCloudConversations(conversations);
  await browser.storage.local.set({ conversationTags: tags, conversationNotes: notes, cooperationProfiles: profiles,
    conversationSopStages: stages, conversationSopStageHistory: [...histories.values()].sort((a, b) => a.changedAt - b.changedAt).slice(-2000),
    [CLOUD_BASELINES]: bases, [CLOUD_CONFLICTS]: conflicts, [CLOUD_SKIPPED]: skipped, [CLOUD_APPLIED]: crypto.randomUUID() });
  await publishConversationMatchIndex();
}

async function removeBaselinesMissingFromFullRestore(remoteConversationIds: Set<string>): Promise<void> {
  const stored = await browser.storage.local.get(CLOUD_BASELINES);
  const bases = { ...((stored[CLOUD_BASELINES] ?? {}) as BaselineMap) };
  let changed = false;
  for (const [localId, baseline] of Object.entries(bases)) {
    if (remoteConversationIds.has(baseline.serverId)) continue;
    delete bases[localId];
    changed = true;
  }
  if (changed) await browser.storage.local.set({ [CLOUD_BASELINES]: bases });
}

export async function recoverCloudData(settings: CloudSettings, progress: (counts: { restoredConversations: number; restoredMessages: number; phase?: string }) => Promise<void>, waitForSlot: () => Promise<void>, options: { fullMetadata?: boolean } = {}) {
  await assertCloudSpace(settings);
  const stored = await browser.storage.local.get(CLOUD_RECOVERY);
  const state: RecoveryState = stored[CLOUD_RECOVERY] ?? {};
  const previous = state.schemaVersion === 9 ? state.resume : undefined;
  // Manual recovery audits every conversation's metadata, but retains the
  // message watermark. A failed full pass resumes its page after worker restart.
  const resume: NonNullable<RecoveryState['resume']> = previous && (!options.fullMetadata || previous.fullMetadata)
    ? previous : {
      resource: 'conversations', since: state.schemaVersion === 9 ? previous?.since ?? state.since ?? 0 : 0,
      fullMetadata: options.fullMetadata === true, conversations: 0, messages: 0,
      ...(options.fullMetadata ? { remoteConversationIds: [] } : {}),
    };
  state.schemaVersion = 9;
  const aliases = state.aliases ?? {};
  const seen = new Set<string>();
  // Persist before the first request, including manual refreshes of an already
  // initialized account. A suspended worker must not bypass a failed restore.
  await browser.storage.local.set({ [CLOUD_RECOVERY]: { ...state, aliases, resume } });
  for (;;) {
    const cursorKey = `${resume.resource}:${resume.after ?? ''}`;
    if (seen.has(cursorKey)) throw new Error('云端分页游标重复，已停止恢复');
    seen.add(cursorKey);
    await waitForSlot();
    await assertCloudSpace(settings);
    const since = resume.resource === 'conversations' && resume.fullMetadata ? 0 : resume.since;
    await progress({ restoredConversations: resume.conversations, restoredMessages: resume.messages,
      phase: `正在请求 /whatsapp/sync/download · ${resume.resource === 'conversations' ? '会话资料' : '聊天消息'}` });
    const page = await downloadCloudPage<CloudConversation | ChatMessage>(settings, resume.resource, since, resume.after);
    await assertCloudSpace(settings);
    resume.watermark ??= page.serverTime;
    if (resume.resource === 'conversations') {
      await applyConversations(settings, page.records as CloudConversation[], aliases);
      if (resume.fullMetadata) {
        const ids = new Set(resume.remoteConversationIds ?? []);
        for (const record of page.records as CloudConversation[]) ids.add(record.id);
        resume.remoteConversationIds = [...ids];
      }
      if (!resume.after) {
        const localTags = await getTagDefinitions();
        const definitions = [...new Map([...localTags, ...page.tagDefinitions].map(t => [t.id, t])).values()];
        await browser.storage.local.set({ tagDefinitions: definitions, [CLOUD_APPLIED]: crypto.randomUUID() });
      }
      resume.conversations += page.records.length;
    } else {
      if ((page.records as ChatMessage[]).some(message => message && !aliases[message.conversationId])) {
        // A new conversation can arrive between the two resource passes. Restart
        // from metadata on retry instead of permanently resuming a missing parent.
        await browser.storage.local.set({ [CLOUD_RECOVERY]: { aliases, since: 0 } });
        throw new Error('云端新增了尚未恢复的会话，下次同步将重新核对完整资料');
      }
      const messages = (page.records as ChatMessage[]).map(message => {
        if (!message || typeof message.id !== 'string' || typeof message.conversationId !== 'string' ||
          typeof message.text !== 'string' || !Number.isFinite(message.capturedAt) || !Array.isArray(message.urls)) throw new Error('云端消息格式不正确');
        const id = aliases[message.conversationId];
        if (!id) throw new Error('消息所属会话尚未恢复');
        return { ...message, conversationId: id, key: `${id}:${message.id}` };
      });
      await importCloudMessages(messages);
      resume.messages += messages.length;
    }
    await progress({ restoredConversations: resume.conversations, restoredMessages: resume.messages,
      phase: `已接收并写入本页${resume.resource === 'conversations' ? '会话资料' : '聊天消息'}：${page.records.length} 条` });
    if (page.nextCursor) resume.after = page.nextCursor;
    else if (resume.resource === 'conversations') {
      if (resume.fullMetadata) {
        await removeBaselinesMissingFromFullRestore(new Set(resume.remoteConversationIds ?? []));
      }
      resume.resource = 'messages'; delete resume.after;
    }
    else break;
    await browser.storage.local.set({ [CLOUD_RECOVERY]: { ...state, aliases, resume } });
  }
  // Advance only after every page is applied. A 1s overlap handles timestamp precision.
  const lastDownloadedAt = Date.now();
  await browser.storage.local.set({ [CLOUD_RECOVERY]: { schemaVersion: 9, aliases, since: Math.max(0, resume.watermark! - 1000), lastPullAt: lastDownloadedAt }, [CLOUD_APPLIED]: crypto.randomUUID() });
  const conflicts = (await browser.storage.local.get(CLOUD_CONFLICTS))[CLOUD_CONFLICTS] ?? {};
  return { restoredConversations: resume.conversations, restoredMessages: resume.messages, lastDownloadedAt, conflictCount: Object.keys(conflicts).length };
}

export async function resolveCloudConflicts(choice: 'local' | 'cloud'): Promise<string[]> {
  const stored = await browser.storage.local.get(CLOUD_CONFLICTS);
  const conflicts = (stored[CLOUD_CONFLICTS] ?? {}) as Record<string, Conflict>;
  const [tags, notes, profiles, stages] = await Promise.all([getConversationTags(), getConversationNotes(), getCooperationProfiles(), getConversationSopStages()]);
  const maps = { tagIds: tags, note: notes, profile: profiles, sopStage: stages };
  if (choice === 'cloud') for (const [id, conflict] of Object.entries(conflicts)) {
    for (const key of METADATA_FIELDS) {
      if (!conflict.fields.includes(key)) continue;
      const map = maps[key] as Record<string, unknown>;
      if (conflict.remote.value[key] === null) delete map[id]; else map[id] = conflict.remote.value[key];
    }
  }
  await browser.storage.local.set({ conversationTags: tags, conversationNotes: notes, cooperationProfiles: profiles,
    conversationSopStages: stages, [CLOUD_CONFLICTS]: {}, [CLOUD_APPLIED]: crypto.randomUUID() });
  return Object.keys(conflicts);
}

export async function migrateCloudAliases(id: string, aliasIds: string[]): Promise<void> {
  if (!aliasIds.length) return;
  await migrateReportAliases(id, aliasIds);
  const stored = await browser.storage.local.get([CLOUD_BASELINES, CLOUD_RECOVERY, CLOUD_CONFLICTS, CLOUD_SKIPPED]);
  const bases = (stored[CLOUD_BASELINES] ?? {}) as BaselineMap;
  const state: RecoveryState = stored[CLOUD_RECOVERY] ?? {};
  const conflicts = (stored[CLOUD_CONFLICTS] ?? {}) as Record<string, Conflict>;
  const skipped = (stored[CLOUD_SKIPPED] ?? {}) as SkippedConversationMap;
  for (const alias of aliasIds) {
    if (bases[alias] && (!bases[id] || bases[alias].revision > bases[id].revision)) bases[id] = bases[alias];
    if (conflicts[alias]) conflicts[id] = conflicts[alias];
    if (skipped[alias] && (!skipped[id] || skipped[alias].revision > skipped[id].revision)) skipped[id] = skipped[alias];
    delete bases[alias]; delete conflicts[alias];
    delete skipped[alias];
  }
  for (const [source, target] of Object.entries(state.aliases ?? {})) if (aliasIds.includes(target)) state.aliases![source] = id;
  await browser.storage.local.set({ [CLOUD_BASELINES]: bases, [CLOUD_CONFLICTS]: conflicts, [CLOUD_RECOVERY]: state, [CLOUD_SKIPPED]: skipped });
}

export function dirtyMetadataFields(local: CloudMetadata, base?: CloudBaseline) {
  return METADATA_FIELDS.filter(key => !base || !sameValue(local[key], base.value[key]));
}

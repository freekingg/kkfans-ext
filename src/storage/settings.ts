import { browser } from 'wxt/browser';
import type {
  AiSettings,
  CaptureSettings,
  CloudSettings,
  CloudSyncState,
  CooperationProfile,
  CooperationProfileMap,
  ConversationNote,
  ConversationNoteMap,
  ConversationIdentity,
  ConversationSopStage,
  ConversationSopStageMap,
  ConversationTagMap,
  SopStageHistoryEntry,
  SopStageSource,
  SopSettings,
  TagDefinition,
} from '../core/types';
import { normalizeConversationPhone } from '../whatsapp/conversation-identity';
import { isSopStageId } from '../sop/stages';
import { isCooperationSpecialStatus } from '../business/statuses';
import { normalizeInstagramProfile } from '../business/instagram-profile';
import { normalizeAdditionSource } from '../business/addition-sources';
import { cloudSpaceKey, CLOUD_SPACE_KEY } from '../cloud/cloud-space';

const KEYS = {
  tags: 'tagDefinitions',
  conversationTags: 'conversationTags',
  conversationNotes: 'conversationNotes',
  cooperationProfiles: 'cooperationProfiles',
  conversationSopStages: 'conversationSopStages',
  conversationSopStageHistory: 'conversationSopStageHistory',
  captureSettings: 'captureSettings',
  cloudSettings: 'cloudSettings',
  cloudSyncState: 'cloudSyncState',
  aiSettings: 'aiSettings',
  sopSettings: 'sopSettings',
} as const;

export const DEFAULT_TAGS: TagDefinition[] = [
  { id: 'follow-up', name: '待跟进', color: '#f59e0b' },
  { id: 'interested', name: '有意向', color: '#14b8a6' },
  { id: 'quoted', name: '已报价', color: '#6366f1' },
  { id: 'video-producing', name: '视频制作中', color: '#8b5cf6' },
  { id: 'video-pending-publish', name: '视频待发布', color: '#f97316' },
  { id: 'video-published', name: '视频已发布', color: '#10b981' },
  { id: 'paid', name: '已付款', color: '#0ea5e9' },
  { id: 'key-creator', name: '重点博主', color: '#ec4899' },
  { id: 'junior-creator', name: '小弟博主', color: '#06b6d4' },
  { id: 'abandoned', name: '放弃', color: '#ef4444' },
  { id: 'paused', name: '暂缓', color: '#94a3b8' },
];

const REMOVED_TAG_IDS = new Set(['partnered']);

function normalizedTagDefinitions(value: unknown): TagDefinition[] {
  const defaultIds = new Set(DEFAULT_TAGS.map((tag) => tag.id));
  const customTags = Array.isArray(value)
    ? value.filter((tag): tag is TagDefinition => Boolean(
        tag && typeof tag === 'object'
        && typeof (tag as TagDefinition).id === 'string'
        && typeof (tag as TagDefinition).name === 'string'
        && typeof (tag as TagDefinition).color === 'string',
      )).filter((tag) => !defaultIds.has(tag.id) && !REMOVED_TAG_IDS.has(tag.id) && tag.name !== '已合作')
    : [];
  return [...DEFAULT_TAGS, ...customTags];
}

function normalizedConversationTags(value: unknown): ConversationTagMap {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([conversationId, tagIds]) => [
      conversationId,
      Array.isArray(tagIds)
        ? tagIds.filter((tagId): tagId is string => typeof tagId === 'string' && !REMOVED_TAG_IDS.has(tagId))
        : [],
    ]),
  );
}

export const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = {
  maxRounds: 300,
  settleMs: 450,
};

export const DEFAULT_CLOUD_SETTINGS: CloudSettings = {
  username: '',
  whatsappAccount: '',
};

export const DEFAULT_CLOUD_SYNC_STATE: CloudSyncState = {
  status: 'idle',
  pendingCount: 0,
  lastSyncedAt: null,
  error: null,
};

export const DEFAULT_AI_SETTINGS: AiSettings = {
  baseUrl: '',
  apiKey: '',
  model: '',
};

export const DEFAULT_SOP_SETTINGS: SopSettings = {
  url: 'https://sop.lllin.fun/?user=kkflow01',
};

export async function getTagDefinitions(): Promise<TagDefinition[]> {
  const result = await browser.storage.local.get(KEYS.tags);
  return normalizedTagDefinitions(result[KEYS.tags]);
}

export async function saveTagDefinitions(tags: TagDefinition[]): Promise<void> {
  await assertMetadataEditable();
  await browser.storage.local.set({ [KEYS.tags]: tags });
}

async function assertMetadataEditable(): Promise<void> {
  const stored = await browser.storage.local.get(KEYS.cloudSyncState);
  if ((stored[KEYS.cloudSyncState] as CloudSyncState | undefined)?.status === 'restoring') {
    throw new Error('云端恢复中，请完成后再保存资料；当前编辑内容尚未保存');
  }
}

export async function getConversationTags(): Promise<ConversationTagMap> {
  const result = await browser.storage.local.get(KEYS.conversationTags);
  return normalizedConversationTags(result[KEYS.conversationTags]);
}

export async function migrateTagSettings(): Promise<void> {
  const result = await browser.storage.local.get([KEYS.tags, KEYS.conversationTags]);
  const tagDefinitions = normalizedTagDefinitions(result[KEYS.tags]);
  const conversationTags = normalizedConversationTags(result[KEYS.conversationTags]);
  const updates: Record<string, unknown> = {};
  if (JSON.stringify(result[KEYS.tags]) !== JSON.stringify(tagDefinitions)) {
    updates[KEYS.tags] = tagDefinitions;
  }
  if (JSON.stringify(result[KEYS.conversationTags] ?? {}) !== JSON.stringify(conversationTags)) {
    updates[KEYS.conversationTags] = conversationTags;
  }
  if (Object.keys(updates).length) await browser.storage.local.set(updates);
}

export async function toggleConversationTag(conversationId: string, tagId: string): Promise<string[]> {
  await assertMetadataEditable();
  const map = await getConversationTags();
  const current = new Set(map[conversationId] ?? []);
  current.has(tagId) ? current.delete(tagId) : current.add(tagId);
  const next = [...current];
  map[conversationId] = next;
  await browser.storage.local.set({ [KEYS.conversationTags]: map });
  return next;
}

export async function getConversationNotes(): Promise<ConversationNoteMap> {
  const result = await browser.storage.local.get(KEYS.conversationNotes);
  const value = result[KEYS.conversationNotes];
  if (!value || typeof value !== 'object') return {};
  const notes: ConversationNoteMap = {};
  for (const [conversationId, rawNote] of Object.entries(value as Record<string, unknown>)) {
    if (typeof rawNote === 'string') {
      const text = rawNote.replace(/\r\n?/g, '\n').trim();
      if (text) notes[conversationId] = { text: text.slice(0, 2000), updatedAt: 0 };
      continue;
    }
    if (!rawNote || typeof rawNote !== 'object') continue;
    const candidate = rawNote as Partial<ConversationNote>;
    const text = typeof candidate.text === 'string'
      ? candidate.text.replace(/\r\n?/g, '\n').trim().slice(0, 2000)
      : '';
    if (!text) continue;
    notes[conversationId] = {
      text,
      updatedAt: Number.isFinite(candidate.updatedAt) ? Number(candidate.updatedAt) : 0,
    };
  }
  return notes;
}

export async function saveConversationNote(
  conversationId: string,
  value: string,
): Promise<ConversationNote | null> {
  await assertMetadataEditable();
  const text = value.replace(/\r\n?/g, '\n').trim();
  if (text.length > 2000) throw new Error('会话备注不能超过 2000 个字符');
  const notes = await getConversationNotes();
  if (!text) {
    delete notes[conversationId];
    await browser.storage.local.set({ [KEYS.conversationNotes]: notes });
    return null;
  }
  const note: ConversationNote = { text, updatedAt: Date.now() };
  notes[conversationId] = note;
  await browser.storage.local.set({ [KEYS.conversationNotes]: notes });
  return note;
}

function normalizedDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? '' : value;
}

export function normalizeCooperationProfile(value: Partial<CooperationProfile>): CooperationProfile {
  const text = (input: unknown, maxLength: number) =>
    (typeof input === 'string' ? input.trim() : '').slice(0, maxLength);
  const instagram = normalizeInstagramProfile(
    text(value.instagramProfileUrl, 2000),
    text(value.instagramUsername, 64),
  );
  return {
    contactWhatsapp: text(value.contactWhatsapp, 64),
    platformAccount: text(value.platformAccount, 120),
    additionSource: normalizeAdditionSource(value.additionSource),
    invitationUrl: text(value.invitationUrl, 2000),
    followerData: text(value.followerData, 4000).replace(/\r\n?/g, '\n'),
    instagramUsername: instagram.username,
    instagramProfileUrl: instagram.profileUrl,
    country: text(value.country, 80),
    finalPrice: text(value.finalPrice, 100),
    specialStatus: isCooperationSpecialStatus(value.specialStatus)
      ? value.specialStatus
      : null,
    nextFollowUpAt: Number.isFinite(value.nextFollowUpAt) && Number(value.nextFollowUpAt) >= 0
      ? Number(value.nextFollowUpAt)
      : null,
    registeredDate: normalizedDate(value.registeredDate),
    publishedDate: normalizedDate(value.publishedDate),
    publishedUrl: text(value.publishedUrl, 2000),
    updatedAt: Number.isFinite(value.updatedAt) ? Number(value.updatedAt) : 0,
  };
}

export function hasCooperationProfileData(profile: CooperationProfile): boolean {
  return Boolean(
    profile.contactWhatsapp || profile.platformAccount || profile.invitationUrl || profile.followerData || profile.instagramUsername || profile.instagramProfileUrl ||
    profile.country || profile.additionSource || profile.finalPrice || profile.specialStatus || profile.nextFollowUpAt ||
    profile.registeredDate || profile.publishedDate || profile.publishedUrl,
  );
}

export async function getCooperationProfiles(): Promise<CooperationProfileMap> {
  const result = await browser.storage.local.get(KEYS.cooperationProfiles);
  const value = result[KEYS.cooperationProfiles];
  if (!value || typeof value !== 'object') return {};
  const profiles: CooperationProfileMap = {};
  for (const [conversationId, candidate] of Object.entries(value as Record<string, unknown>)) {
    if (!candidate || typeof candidate !== 'object') continue;
    const profile = normalizeCooperationProfile(candidate as Partial<CooperationProfile>);
    if (hasCooperationProfileData(profile)) profiles[conversationId] = profile;
  }
  return profiles;
}

export async function saveCooperationProfile(
  conversationId: string,
  value: CooperationProfile,
): Promise<CooperationProfile | null> {
  await assertMetadataEditable();
  const profiles = await getCooperationProfiles();
  const profile = normalizeCooperationProfile({ ...value, updatedAt: Date.now() });
  if (!hasCooperationProfileData(profile)) {
    delete profiles[conversationId];
    await browser.storage.local.set({ [KEYS.cooperationProfiles]: profiles });
    return null;
  }
  profiles[conversationId] = profile;
  await browser.storage.local.set({ [KEYS.cooperationProfiles]: profiles });
  return profile;
}

export async function getConversationSopStages(): Promise<ConversationSopStageMap> {
  const result = await browser.storage.local.get(KEYS.conversationSopStages);
  const value = result[KEYS.conversationSopStages];
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, ConversationSopStage] => {
      const stage = entry[1] as Partial<ConversationSopStage> | null;
      return Boolean(stage && isSopStageId(stage.stageId));
    }),
  );
}

export async function getConversationSopStageHistory(): Promise<SopStageHistoryEntry[]> {
  const result = await browser.storage.local.get(KEYS.conversationSopStageHistory);
  const value = result[KEYS.conversationSopStageHistory];
  return Array.isArray(value) ? (value as SopStageHistoryEntry[]) : [];
}

export async function confirmConversationSopStage(input: {
  conversationId: string;
  stageId: string;
  source: SopStageSource;
  confidence?: number | null;
  sopKnowledgeVersion?: string | null;
}): Promise<ConversationSopStage> {
  await assertMetadataEditable();
  if (!isSopStageId(input.stageId)) throw new Error('SOP 阶段无效');
  const [map, history] = await Promise.all([
    getConversationSopStages(),
    getConversationSopStageHistory(),
  ]);
  const previous = map[input.conversationId] ?? null;
  const now = Date.now();
  const stage: ConversationSopStage = {
    stageId: input.stageId,
    source: input.source,
    confidence: input.confidence ?? null,
    confirmedAt: now,
    updatedAt: now,
    sopKnowledgeVersion: input.sopKnowledgeVersion ?? null,
  };
  map[input.conversationId] = stage;
  const nextHistory = previous?.stageId === stage.stageId
    ? history
    : [
        ...history,
        {
          eventId: crypto.randomUUID(),
          conversationId: input.conversationId,
          fromStageId: previous?.stageId ?? null,
          toStageId: stage.stageId,
          source: stage.source,
          confidence: stage.confidence,
          sopKnowledgeVersion: stage.sopKnowledgeVersion,
          changedAt: now,
        },
      ].slice(-2000);
  await browser.storage.local.set({
    [KEYS.conversationSopStages]: map,
    [KEYS.conversationSopStageHistory]: nextHistory,
  });
  return stage;
}

export async function mergeConversationStorageAliases(
  conversation: ConversationIdentity,
  aliasIds: string[],
): Promise<string[]> {
  const [tags, notes, profiles, stages, history] = await Promise.all([
    getConversationTags(),
    getConversationNotes(),
    getCooperationProfiles(),
    getConversationSopStages(),
    getConversationSopStageHistory(),
  ]);
  const phone = normalizeConversationPhone(conversation.title);
  const profileAliasIds = phone
    ? Object.entries(profiles)
        .filter(([, profile]) => normalizeConversationPhone(profile.contactWhatsapp) === phone)
        .map(([sourceId]) => sourceId)
    : [];
  const conversationId = conversation.id;
  const aliases = [...new Set([...aliasIds, ...profileAliasIds])]
    .filter((aliasId) => aliasId !== conversationId);
  if (!aliases.length) return [];
  const sourceIds = [conversationId, ...aliases];

  const mergedTags = [...new Set(sourceIds.flatMap((sourceId) => tags[sourceId] ?? []))];
  if (mergedTags.length) tags[conversationId] = mergedTags;
  else delete tags[conversationId];

  const latestNote = sourceIds
    .map((sourceId) => notes[sourceId])
    .filter((value): value is ConversationNote => Boolean(value))
    .sort((left, right) => right.updatedAt - left.updatedAt)[0];
  if (latestNote) notes[conversationId] = latestNote;
  else delete notes[conversationId];

  const latestProfile = sourceIds
    .map((sourceId) => profiles[sourceId])
    .filter((value): value is CooperationProfile => Boolean(value))
    .sort((left, right) => right.updatedAt - left.updatedAt)[0];
  if (latestProfile) profiles[conversationId] = latestProfile;
  else delete profiles[conversationId];

  const latestStage = sourceIds
    .map((sourceId) => stages[sourceId])
    .filter((value): value is ConversationSopStage => Boolean(value))
    .sort((left, right) => right.updatedAt - left.updatedAt)[0];
  if (latestStage) stages[conversationId] = latestStage;
  else delete stages[conversationId];

  aliases.forEach((aliasId) => {
    delete tags[aliasId];
    delete notes[aliasId];
    delete profiles[aliasId];
    delete stages[aliasId];
  });
  const historyByEventId = new Map<string, SopStageHistoryEntry>();
  for (const entry of history) {
    const migrated = sourceIds.includes(entry.conversationId)
      ? { ...entry, conversationId }
      : entry;
    const key = `${migrated.conversationId}:${migrated.eventId}`;
    const previous = historyByEventId.get(key);
    if (!previous || migrated.changedAt >= previous.changedAt) {
      historyByEventId.set(key, migrated);
    }
  }

  await browser.storage.local.set({
    [KEYS.conversationTags]: tags,
    [KEYS.conversationNotes]: notes,
    [KEYS.cooperationProfiles]: profiles,
    [KEYS.conversationSopStages]: stages,
    [KEYS.conversationSopStageHistory]: [...historyByEventId.values()].slice(-2000),
  });
  return aliases;
}

export async function getCaptureSettings(): Promise<CaptureSettings> {
  const result = await browser.storage.local.get(KEYS.captureSettings);
  const value = result[KEYS.captureSettings];
  return value && typeof value === 'object'
    ? { ...DEFAULT_CAPTURE_SETTINGS, ...(value as Partial<CaptureSettings>) }
    : DEFAULT_CAPTURE_SETTINGS;
}

export async function saveCaptureSettings(settings: CaptureSettings): Promise<void> {
  await browser.storage.local.set({ [KEYS.captureSettings]: settings });
}

export function normalizeCloudSettings(settings: CloudSettings): CloudSettings {
  return {
    username: settings.username.trim(),
    whatsappAccount: settings.whatsappAccount.replace(/\s/g, ''),
  };
}

export function validateCloudSettings(settings: CloudSettings): string | null {
  if (/\s/.test(settings.whatsappAccount)) return 'WhatsApp 账号不能包含空格';
  const normalized = normalizeCloudSettings(settings);
  if (!normalized.username) return '请输入用户名';
  if (normalized.username.length > 64) return '用户名不能超过64个字符';
  if (!normalized.whatsappAccount) return '请输入 WhatsApp 账号';
  if (!/^\+?[0-9()-]{5,32}$/.test(normalized.whatsappAccount)) {
    return 'WhatsApp 账号格式不正确';
  }
  return null;
}

export async function getCloudSettings(): Promise<CloudSettings> {
  const result = await browser.storage.local.get(KEYS.cloudSettings);
  const value = result[KEYS.cloudSettings];
  return value && typeof value === 'object'
    ? normalizeCloudSettings({
        ...DEFAULT_CLOUD_SETTINGS,
        ...(value as Partial<CloudSettings>),
      })
    : DEFAULT_CLOUD_SETTINGS;
}

export async function saveCloudSettings(settings: CloudSettings): Promise<void> {
  const error = validateCloudSettings(settings);
  if (error) throw new Error(error);
  const normalized = normalizeCloudSettings(settings);
  const stored = await browser.storage.local.get([CLOUD_SPACE_KEY, KEYS.cloudSettings]);
  const previous = stored[KEYS.cloudSettings] as CloudSettings | undefined;
  const boundSpace = stored[CLOUD_SPACE_KEY] || (previous?.username && previous.whatsappAccount ? cloudSpaceKey(previous) : null);
  if (boundSpace && boundSpace !== cloudSpaceKey(normalized)) {
    throw new Error('本地数据已绑定其他账号，请使用独立浏览器环境；不能将旧数据同步到新账号');
  }
  await browser.storage.local.set({ [KEYS.cloudSettings]: normalized });
}

export async function getCloudSyncState(): Promise<CloudSyncState> {
  const result = await browser.storage.local.get(KEYS.cloudSyncState);
  const value = result[KEYS.cloudSyncState];
  return value && typeof value === 'object'
    ? { ...DEFAULT_CLOUD_SYNC_STATE, ...(value as Partial<CloudSyncState>) }
    : DEFAULT_CLOUD_SYNC_STATE;
}

export async function saveCloudSyncState(state: CloudSyncState): Promise<void> {
  await browser.storage.local.set({ [KEYS.cloudSyncState]: state });
}

export function normalizeAiSettings(settings: AiSettings): AiSettings {
  return {
    baseUrl: settings.baseUrl.trim().replace(/\/+$/, ''),
    apiKey: settings.apiKey.trim(),
    model: settings.model.trim(),
  };
}

export function validateAiSettings(settings: AiSettings): string | null {
  const normalized = normalizeAiSettings(settings);
  if (!normalized.baseUrl) return '请输入模型接口地址';
  try {
    const url = new URL(normalized.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return '模型接口地址只支持 HTTP 或 HTTPS';
  } catch {
    return '模型接口地址格式不正确';
  }
  if (!normalized.apiKey) return '请输入模型 API Key';
  if (normalized.apiKey.length > 4096) return '模型 API Key 过长';
  if (!normalized.model) return '请输入模型名称';
  if (normalized.model.length > 200) return '模型名称不能超过200个字符';
  return null;
}

export async function getAiSettings(): Promise<AiSettings> {
  const result = await browser.storage.local.get(KEYS.aiSettings);
  const value = result[KEYS.aiSettings];
  return value && typeof value === 'object'
    ? normalizeAiSettings({
        ...DEFAULT_AI_SETTINGS,
        ...(value as Partial<AiSettings>),
      })
    : DEFAULT_AI_SETTINGS;
}

export async function saveAiSettings(settings: AiSettings): Promise<void> {
  const normalized = normalizeAiSettings(settings);
  const error = validateAiSettings(normalized);
  if (error) throw new Error(error);
  await browser.storage.local.set({ [KEYS.aiSettings]: normalized });
}

export function normalizeSopSettings(settings: SopSettings): SopSettings {
  return { url: settings.url.trim() };
}

export function validateSopSettings(settings: SopSettings): string | null {
  const normalized = normalizeSopSettings(settings);
  if (!normalized.url) return '请输入 SOP 页面地址';
  try {
    const url = new URL(normalized.url);
    if (url.protocol !== 'https:') return 'SOP 页面地址必须使用 HTTPS';
  } catch {
    return 'SOP 页面地址格式不正确';
  }
  return null;
}

export async function getSopSettings(): Promise<SopSettings> {
  const result = await browser.storage.local.get(KEYS.sopSettings);
  const value = result[KEYS.sopSettings];
  if (!value || typeof value !== 'object') return DEFAULT_SOP_SETTINGS;
  const normalized = normalizeSopSettings({
    ...DEFAULT_SOP_SETTINGS,
    ...(value as Partial<SopSettings>),
  });
  return validateSopSettings(normalized) ? DEFAULT_SOP_SETTINGS : normalized;
}

export async function saveSopSettings(settings: SopSettings): Promise<void> {
  const normalized = normalizeSopSettings(settings);
  const error = validateSopSettings(normalized);
  if (error) throw new Error(error);
  await browser.storage.local.set({ [KEYS.sopSettings]: normalized });
}

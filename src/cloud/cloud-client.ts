import { browser } from 'wxt/browser';
import type {
  ChatMessage,
  CloudSettings,
  CooperationProfile,
  ConversationNote,
  ConversationSopStage,
  ConversationRecord,
  SopStageHistoryEntry,
  TagDefinition,
} from '../core/types';
import { CLOUD_API_BASE_URL } from './config';
import type { CloudMetadata, MetadataField } from './cloud-merge';

export interface CloudConversation extends ConversationRecord, CloudMetadata {
  revision: number;
  sopStageHistory: SopStageHistoryEntry[];
}

export interface CloudDownloadPage<T> {
  schemaVersion: number;
  username: string;
  whatsappAccountKey: string;
  serverTime: number;
  tagDefinitions: TagDefinition[];
  records: T[];
  nextCursor: string | null;
}

export interface CloudUploadResult {
  revision: number;
  conversationId: string;
  total?: number;
  skipped?: 'deleted';
}

export async function downloadCloudPage<T>(settings: CloudSettings, resource: 'conversations' | 'messages', since: number, after?: string): Promise<CloudDownloadPage<T>> {
  const response = await fetch(`${CLOUD_API_BASE_URL}/whatsapp/sync/download`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({ ...settings, resource, since, after, limit: resource === 'messages' ? 200 : 50 }),
  });
  const body = await response.json().catch(() => null) as CloudApiResponse | null;
  if (!response.ok || body?.code !== 200) {
    throw new CloudUploadError(response.status === 404
      ? '服务端尚未部署云端恢复接口，已阻止上传，请先更新服务端'
      : body?.message || `云端恢复失败 (${response.status})`, response.status, retryAfterMs(response));
  }
  const page = body.data as CloudDownloadPage<T> | null;
  if (page && (!Number.isInteger(page.schemaVersion) || page.schemaVersion < 9)) {
    throw new Error('服务端尚未更新防重复同步协议，已阻止上传，请先部署新版服务端');
  }
  if (!page || page.username !== settings.username.trim() || page.whatsappAccountKey !== settings.whatsappAccount.replace(/\D/g, '') ||
    !Array.isArray(page.records) || !Array.isArray(page.tagDefinitions) || !Number.isSafeInteger(page.serverTime) ||
    (page.nextCursor !== null && typeof page.nextCursor !== 'string')) throw new Error('云端恢复响应或账号不匹配，已阻止上传');
  return page;
}

interface CloudApiResponse {
  code: number;
  message: string;
  data: unknown;
}

export class CloudUploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = 'CloudUploadError';
  }
}

function retryAfterMs(response: Response): number | null {
  const value = response.headers.get('Retry-After')?.trim();
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : null;
}

function toCloudMessage(message: ChatMessage): ChatMessage {
  const payload = { ...message };
  delete payload.orderIndex;
  delete payload.cloudSynced;
  delete payload.sourceAliases;
  return payload;
}

export async function uploadConversationBatch(input: {
  settings: CloudSettings;
  conversation: ConversationRecord;
  tagIds: string[];
  tagDefinitions: TagDefinition[];
  note: ConversationNote | null;
  profile: CooperationProfile | null;
  sopStage: ConversationSopStage | null;
  sopStageHistory: SopStageHistoryEntry[];
  messages: ChatMessage[];
  metadataBaseVersion?: number;
  metadataFields?: MetadataField[];
}): Promise<CloudUploadResult> {
  const response = await fetch(`${CLOUD_API_BASE_URL}/whatsapp/sync/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      username: input.settings.username,
      whatsappAccount: input.settings.whatsappAccount,
      schemaVersion: 9,
      metadataBaseVersion: input.metadataBaseVersion,
      metadataFields: input.metadataFields ?? [],
      pluginVersion: browser.runtime.getManifest().version,
      tagDefinitions: input.tagDefinitions,
      conversation: {
        id: input.conversation.id,
        title: input.conversation.title,
        avatarKey: input.conversation.avatarKey,
        tagIds: input.tagIds,
        note: input.note,
        profile: input.profile,
        sopStage: input.sopStage,
        sopStageHistory: input.sopStageHistory,
        createdAt: input.conversation.createdAt,
        updatedAt: input.conversation.updatedAt,
        lastCapturedAt: input.conversation.lastCapturedAt,
        oldestMessageId: input.conversation.oldestMessageId,
        ...(input.conversation.historyStart !== undefined
          ? { historyStart: input.conversation.historyStart } : {}),
        newestMessageId: input.conversation.newestMessageId,
      },
      messages: input.messages.map(toCloudMessage),
    }),
  });
  const body = (await response.json().catch(() => null)) as CloudApiResponse | null;
  if (!response.ok || body?.code !== 200) {
    if (response.status === 429) {
      throw new CloudUploadError(
        '同步请求过于频繁，已进入自动退避队列',
        response.status,
        retryAfterMs(response),
      );
    }
    throw new CloudUploadError(
      body?.message || `云端接口请求失败 (${response.status})`,
      response.status,
    );
  }
  const result = body.data as Partial<CloudUploadResult> | null;
  if (!result || !Number.isSafeInteger(result.revision) || typeof result.conversationId !== 'string' ||
    (result.total !== undefined && (!Number.isSafeInteger(result.total) || result.total < 0)) ||
    (result.skipped !== undefined && result.skipped !== 'deleted')) {
    throw new Error('服务端未返回安全同步版本，请先更新服务端');
  }
  return {
    revision: result.revision!, conversationId: result.conversationId,
    ...(result.total === undefined ? {} : { total: result.total }),
    ...(result.skipped ? { skipped: result.skipped } : {}),
  };
}

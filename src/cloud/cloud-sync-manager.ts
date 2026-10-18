import { browser } from 'wxt/browser';
import { canReport, finishReport, readReportPolicy, requestReport } from './report-policy';
import type { ChatMessage, CloudSettings, CloudSyncState, ConversationTagMap } from '../core/types';
import { acknowledgeCloudMessages, listAllMessages, listConversations } from '../storage/message-db';
import {
  DEFAULT_CLOUD_SYNC_STATE,
  getCloudSettings,
  getCooperationProfiles,
  getConversationNotes,
  getConversationSopStageHistory,
  getConversationSopStages,
  getConversationTags,
  getTagDefinitions,
  saveCloudSyncState,
  validateCloudSettings,
} from '../storage/settings';
import { uploadConversationBatch, type CloudUploadResult } from './cloud-client';
import { assertCloudSpace } from './cloud-space';
import { migrateLocalConversationIdentities } from './cloud-identity-migration';
import { resolveConversationIdentity } from '../whatsapp/conversation-identity';
import { CLOUD_BASELINES, CLOUD_CONFLICTS, CLOUD_RECOVERY, CLOUD_SKIPPED, type BaselineMap, type SkippedConversationMap, recoverCloudData, readCloudBaselines, saveCloudBaseline, dirtyMetadataFields, resolveCloudConflicts } from './cloud-recovery';
import {
  CLOUD_SYNC_ALARM,
  CLOUD_SYNC_BATCH_SIZE,
  CLOUD_SYNC_CURSOR_KEY,
  CLOUD_SYNC_MIN_REQUEST_INTERVAL_MS,
  CLOUD_SYNC_PENDING_KEY,
  CLOUD_SYNC_RATE_LIMIT_FALLBACK_MS,
} from './config';

interface MessageSyncCursor {
  capturedAt: number;
  keys: string[];
}

type MessageSyncCursorMap = Record<string, MessageSyncCursor>;
const CLOUD_PULL_REQUEST = 'cloudPullRequest';
const CLOUD_VERSION_CONFLICT = 'cloudVersionConflict';

interface VersionConflict {
  conversationId: string;
  title: string;
  baseVersion: number;
  attempts: number;
  reason?: string;
}

class MetadataVersionConflict extends Error {
  constructor(readonly details: Omit<VersionConflict, 'attempts'>) {
    super('云端资料版本不一致');
  }
}

function conflictMessage(conflict: VersionConflict): string {
  const reason = conflict.reason ? `服务端返回：${conflict.reason}。` : '';
  return `会话「${conflict.title}」完整恢复后仍被服务端拒绝（本地版本 ${conflict.baseVersion}）。${reason}已暂停重复上传，本地资料和待同步消息均已保留。请核对服务端会话状态后点击当前会话的“重试上报”。`;
}

function cursorStorageKey(settings: CloudSettings, conversationId: string): string {
  return JSON.stringify([
    settings.username.trim(),
    settings.whatsappAccount.trim(),
    conversationId,
  ]);
}

function normalizeCursorMap(value: unknown): MessageSyncCursorMap {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([key, candidate]) => {
      if (!candidate || typeof candidate !== 'object') return [];
      const cursor = candidate as Partial<MessageSyncCursor>;
      if (!Number.isFinite(cursor.capturedAt) || Number(cursor.capturedAt) < 0) return [];
      return [[key, {
        capturedAt: Number(cursor.capturedAt),
        keys: Array.isArray(cursor.keys)
          ? cursor.keys.filter((messageKey): messageKey is string => typeof messageKey === 'string').slice(-500)
          : [],
      }]];
    }),
  );
}

function unsyncedMessages(messages: ChatMessage[], cursor?: MessageSyncCursor): ChatMessage[] {
  if (!cursor) return messages.filter(message => !message.cloudSynced);
  const keysAtCursor = new Set(cursor.keys);
  return messages.filter((message) =>
    !message.cloudSynced && (message.capturedAt > cursor.capturedAt
    || (message.capturedAt === cursor.capturedAt && !keysAtCursor.has(message.key))));
}

function advancedCursor(
  previous: MessageSyncCursor | undefined,
  messages: ChatMessage[],
): MessageSyncCursor | undefined {
  const capturedTimes = messages
    .map((message) => message.capturedAt)
    .filter((value) => Number.isFinite(value) && value >= 0);
  if (!capturedTimes.length) return previous;
  const capturedAt = Math.max(previous?.capturedAt ?? -1, ...capturedTimes);
  const keys = new Set(
    previous?.capturedAt === capturedAt ? previous.keys : [],
  );
  messages
    .filter((message) => message.capturedAt === capturedAt)
    .forEach((message) => keys.add(message.key));
  return { capturedAt, keys: [...keys].slice(-500) };
}

function rateLimitRetryMs(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const candidate = error as { status?: unknown; retryAfterMs?: unknown };
  if (candidate.status !== 429) return null;
  return Number.isFinite(candidate.retryAfterMs)
    ? Math.max(1000, Number(candidate.retryAfterMs) + 5000)
    : CLOUD_SYNC_RATE_LIMIT_FALLBACK_MS;
}

export class CloudSyncManager {
  private pending = new Set<string>();
  private loaded = false;
  private loadingPending: Promise<void> | null = null;
  private running = false;
  private rerunAll = false;
  private requeueAfterCurrent = new Set<string>();
  private cursors: MessageSyncCursorMap = {};
  private cursorsLoaded = false;
  private lastRequestStartedAt = 0;
  private pullRequested = false;
  private restoring = false;

  constructor(
    private readonly minRequestIntervalMs = CLOUD_SYNC_MIN_REQUEST_INTERVAL_MS,
  ) {}

  async start(): Promise<void> {
    await this.loadPending();
    await browser.alarms.create('kkfans-whatsapp-cloud-pull', { periodInMinutes: 5 });
    void this.flush();
  }

  isRestoring(): boolean { return this.restoring; }

  async resolveConflicts(choice: 'local' | 'cloud'): Promise<void> {
    if (this.running) throw new Error('同步进行中，请稍后再处理冲突');
    const settings = await getCloudSettings();
    await assertCloudSpace(settings);
    const ids = await resolveCloudConflicts(choice);
    await this.loadPending();
    ids.forEach(id => this.pending.add(id));
    await this.persistPending();
    await this.publish({ conflictCount: 0, error: null });
    void this.flush();
  }

  async enqueueConversation(conversationId: string): Promise<void> {
    if (!canReport(await readReportPolicy(), conversationId)) return;
    await this.clearSkipped(conversationId);
    await this.loadPending();
    if (this.running && this.pending.has(conversationId)) {
      this.requeueAfterCurrent.add(conversationId);
    }
    this.pending.add(conversationId);
    await this.persistPending();
    if (!this.running) await this.publish({ status: 'pending', error: null });
    void this.flush();
  }

  async enqueueAll(pull = true): Promise<void> {
    if (pull && !this.restoring) {
      this.pullRequested = true;
      // Do not rely on the upload queue or worker memory to retain a manual pull.
      await this.clearSkipped();
      await browser.storage.local.set({
        [CLOUD_PULL_REQUEST]: crypto.randomUUID(),
        [CLOUD_VERSION_CONFLICT]: null,
      });
      if (!this.running) await this.publish({ status: 'pending', error: null, phase: '已收到恢复请求，正在读取本地会话' });
    }
    const conversations = await listConversations();
    await this.loadPending();
    if (this.running) this.rerunAll = true;
    const policy = await readReportPolicy();
    conversations.filter(c => canReport(policy, c.id)).forEach(c => this.pending.add(c.id));
    await this.persistPending();
    if (!this.running) await this.publish({ status: this.pending.size ? 'pending' : 'idle', error: null });
    void this.flush();
  }

  async retry(): Promise<void> {
    await this.loadPending();
    void this.flush();
  }

  async reportConversation(conversationId: string): Promise<void> {
    const settings = await getCloudSettings();
    const error = validateCloudSettings(settings);
    if (error) throw new Error(error);
    await assertCloudSpace(settings);
    if (!(await listConversations()).some(c => c.id === conversationId)) throw new Error('请先读取当前会话消息');
    await requestReport(conversationId);
    await browser.storage.local.set({ [CLOUD_VERSION_CONFLICT]: null, [CLOUD_PULL_REQUEST]: crypto.randomUUID() });
    this.pullRequested = true;
    await this.enqueueConversation(conversationId);
  }

  private async flush(): Promise<void> {
    if (this.running) return;
    this.running = true;
    let shouldContinue = false;
    let completed = false;
    try {
      const settings = await getCloudSettings();
      if (validateCloudSettings(settings)) {
        await this.publish({ status: 'idle', error: null });
        return;
      }
      await assertCloudSpace(settings);
      const policy = await readReportPolicy();
      // Old automatic queues do not constitute consent to report a conversation.
      this.pending = new Set([...this.pending, ...Object.keys(policy.requests)].filter(id => canReport(policy, id)));
      await this.persistPending();
      const stored = await browser.storage.local.get([CLOUD_RECOVERY, CLOUD_PULL_REQUEST, CLOUD_VERSION_CONFLICT]);
      const versionConflict = stored[CLOUD_VERSION_CONFLICT] as VersionConflict | undefined;
      if (versionConflict && versionConflict.attempts >= 2 && canReport(policy, versionConflict.conversationId)) {
        await this.publish({ status: 'error', phase: '版本核对未通过，已暂停重复上传', error: conflictMessage(versionConflict) });
        return;
      }
      const recovery = stored[CLOUD_RECOVERY] as { schemaVersion?: number; lastPullAt?: number; resume?: unknown } | undefined;
      const pullRequest = stored[CLOUD_PULL_REQUEST];
      if (pullRequest || this.pullRequested || recovery?.schemaVersion !== 9 || !recovery?.lastPullAt || recovery.resume || Date.now() - recovery.lastPullAt >= 5 * 60_000) {
        this.pullRequested = false;
        this.restoring = true;
        await this.publish({ status: 'restoring', error: null, restoredConversations: 0, restoredMessages: 0,
          phase: '正在核对本地会话标识，尚未请求下载' });
        await migrateLocalConversationIdentities(settings);
        const restored = await recoverCloudData(settings,
          counts => this.publish({ status: 'restoring', ...counts }), () => this.waitForRequestSlot(), { fullMetadata: Boolean(pullRequest) });
        // Recovery can reintroduce a legacy cloud ID beside a local stable ID.
        // Collapse exact-phone aliases before any queued upload reads baselines.
        await migrateLocalConversationIdentities(settings);
        if (pullRequest && (await browser.storage.local.get(CLOUD_PULL_REQUEST))[CLOUD_PULL_REQUEST] === pullRequest) {
          await browser.storage.local.set({ [CLOUD_PULL_REQUEST]: null });
        }
        this.restoring = false;
        await this.publish(restored);
        // Include pre-existing offline edits, but syncConversation skips clean cloud records.
        const restoredPolicy = await readReportPolicy();
        (await listConversations()).filter(c => canReport(restoredPolicy, c.id)).forEach(c => this.pending.add(c.id));
        await this.persistPending();
      }
      const conflicts = (await browser.storage.local.get(CLOUD_CONFLICTS))[CLOUD_CONFLICTS] ?? {};
      const uploadPolicy = await readReportPolicy();
      if (Object.keys(conflicts).some(id => canReport(uploadPolicy, id))) {
        await this.publish({ status: 'error', conflictCount: Object.keys(conflicts).length,
          error: '本地和云端修改了同一项资料，双方数据均已保留，请在设置中选择保留版本' });
        return;
      }
      while (this.pending.size > 0) {
        const conversationId = this.pending.values().next().value as string;
        await this.publish({ status: 'syncing', error: null, phase: '正在核对并上传本地增量修改' });
        const reportPolicy = await readReportPolicy();
        if (canReport(reportPolicy, conversationId) && await this.syncConversation(conversationId, settings)) {
          await finishReport(conversationId, reportPolicy.requests[conversationId]);
        }
        const conflict = (await browser.storage.local.get(CLOUD_VERSION_CONFLICT))[CLOUD_VERSION_CONFLICT] as VersionConflict | undefined;
        if (conflict?.conversationId === conversationId) await browser.storage.local.set({ [CLOUD_VERSION_CONFLICT]: null });
        if (!this.requeueAfterCurrent.delete(conversationId)) {
          this.pending.delete(conversationId);
        }
        await this.persistPending();
      }
      if (this.rerunAll) {
        this.rerunAll = false;
        const conversations = await listConversations();
        const nextPolicy = await readReportPolicy();
        conversations.filter(c => canReport(nextPolicy, c.id)).forEach(c => this.pending.add(c.id));
        await this.persistPending();
        await this.publish({ status: 'pending', error: null });
        shouldContinue = true;
      } else {
        await this.publish({ status: 'success', error: null, lastSyncedAt: Date.now(), phase: '本轮同步处理完成' });
        await browser.alarms.clear(CLOUD_SYNC_ALARM);
      }
      completed = true;
    } catch (error) {
      if (error instanceof MetadataVersionConflict) {
        const previous = (await browser.storage.local.get(CLOUD_VERSION_CONFLICT))[CLOUD_VERSION_CONFLICT] as VersionConflict | undefined;
        const conflict = { ...error.details, attempts: (previous?.attempts ?? 0) + 1 };
        // Persist the full metadata pull and retry budget together. Worker restarts
        // must neither lose the restore request nor reset a persistent 409 loop.
        await browser.storage.local.set({ [CLOUD_VERSION_CONFLICT]: conflict,
          ...(conflict.attempts === 1 ? { [CLOUD_PULL_REQUEST]: crypto.randomUUID() } : {}) });
        if (conflict.attempts === 1) {
          this.pullRequested = true;
          await this.publish({ status: 'restoring', error: null, phase: `会话「${conflict.title}」版本发生变化，正在重新核对完整云端资料` });
          completed = true;
          shouldContinue = true;
        } else {
          await this.publish({ status: 'error', phase: '版本核对未通过，已暂停重复上传', error: conflictMessage(conflict) });
          await browser.alarms.clear(CLOUD_SYNC_ALARM);
        }
        return;
      }
      if (this.restoring) this.pullRequested = true;
      const retryMs = rateLimitRetryMs(error);
      await this.publish({
        status: 'error',
        error: retryMs
          ? `同步请求过于频繁，约 ${Math.ceil(retryMs / 1000)} 秒后自动重试`
          : error instanceof Error ? error.message : '云端同步失败',
      });
      await browser.alarms.create(CLOUD_SYNC_ALARM, {
        delayInMinutes: retryMs ? Math.max(1, retryMs / 60_000) : 1,
      });
    } finally {
      this.restoring = false;
      this.running = false;
      // A queued download is useful even with zero local conversations/uploads.
      if (completed && (shouldContinue || this.rerunAll || this.pullRequested)) void this.flush();
    }
  }

  private async syncConversation(
    conversationId: string,
    settings: Awaited<ReturnType<typeof getCloudSettings>>,
  ): Promise<boolean> {
    const skipped = (await browser.storage.local.get(CLOUD_SKIPPED))[CLOUD_SKIPPED] as SkippedConversationMap | undefined;
    if (skipped?.[conversationId]) return false;
    const [conversations, messages, tagDefinitions, tagMap, noteMap, profileMap, stageMap, stageHistory] = await Promise.all([
      listConversations(),
      listAllMessages(conversationId),
      getTagDefinitions(),
      getConversationTags(),
      getConversationNotes(),
      getCooperationProfiles(),
      getConversationSopStages(),
      getConversationSopStageHistory(),
    ]);
    const conversation = conversations.find((item) => item.id === conversationId);
    if (!conversation) return false;
    resolveConversationIdentity({ ...conversation, contactWhatsapp: profileMap[conversationId]?.contactWhatsapp }, settings.username,
      conversations.map(record => ({ id: record.id, title: record.title, contactWhatsapp: profileMap[record.id]?.contactWhatsapp })));
    await this.loadCursors();
    const cursorKey = cursorStorageKey(settings, conversationId);
    const value = { tagIds: tagMap[conversationId] ?? [], note: noteMap[conversationId] ?? null,
      profile: profileMap[conversationId] ?? null, sopStage: stageMap[conversationId] ?? null };
    let baseline = (await readCloudBaselines())[conversationId];
    // A server-side deletion can leave local messages acknowledged while the
    // recreated cloud parent is empty. The downloaded message count is the
    // authority for repair: if it is missing or lower than local, resend the
    // complete local history and ignore stale flags/cursors for this pass.
    const acknowledgedLocalMessageCount = messages.filter(message => message.cloudSynced === true).length;
    const cloudHistoryNeedsRepair = !baseline
      || !Number.isSafeInteger(baseline.messageCount)
      || (baseline.messageCount ?? 0) < acknowledgedLocalMessageCount;
    const pendingMessages = cloudHistoryNeedsRepair
      ? messages
      : unsyncedMessages(messages, this.cursors[cursorKey]);
    let fields = dirtyMetadataFields(value, baseline);
    if (!fields.length && !pendingMessages.length &&
      (!conversation.historyStart || JSON.stringify(conversation.historyStart) === JSON.stringify(baseline?.historyStart))) return true;
    const batches = Math.max(1, Math.ceil(pendingMessages.length / CLOUD_SYNC_BATCH_SIZE));
    for (let index = 0; index < batches; index += 1) {
      await this.waitForRequestSlot();
      await assertCloudSpace(settings);
      if (!canReport(await readReportPolicy(), conversationId)) return false;
      const batch = pendingMessages.slice(index * CLOUD_SYNC_BATCH_SIZE, (index + 1) * CLOUD_SYNC_BATCH_SIZE);
      let result: CloudUploadResult;
      try {
        result = await uploadConversationBatch({
          settings,
          conversation,
          tagIds: (tagMap as ConversationTagMap)[conversationId] ?? [],
          tagDefinitions,
          note: noteMap[conversationId] ?? null,
          profile: profileMap[conversationId] ?? null,
          sopStage: stageMap[conversationId] ?? null,
          sopStageHistory: stageHistory
            .filter((entry) => entry.conversationId === conversationId)
            .slice(-200),
          messages: batch,
          metadataFields: fields,
          metadataBaseVersion: baseline?.revision ?? 0,
        });
      } catch (error) {
        if ((error as { status?: number })?.status === 409) {
          throw new MetadataVersionConflict({
            conversationId,
            title: conversation.title,
            baseVersion: baseline?.revision ?? 0,
            ...(error instanceof Error ? { reason: error.message } : {}),
          });
        }
        throw error;
      }
      if (result.skipped === 'deleted') {
        if (!this.requeueAfterCurrent.has(conversationId) && !this.rerunAll) {
          const current = (await browser.storage.local.get(CLOUD_SKIPPED))[CLOUD_SKIPPED] ?? {};
          await browser.storage.local.set({ [CLOUD_SKIPPED]: { ...current, [conversationId]: {
            serverId: result.conversationId, revision: result.revision, title: conversation.title, reason: 'deleted',
          } } });
        }
        // Skipped is NOT an upload acknowledgement. Preserve all local edits and
        // unsent messages, but do not let this tombstone block the remaining queue.
        if ((await readReportPolicy()).requests[conversationId]) throw new Error('服务端跳过了此会话，上报未完成，请更新服务端后重试上报');
        return false;
      }
      baseline = {
        revision: result.revision,
        serverId: result.conversationId,
        value,
        historyStart: conversation.historyStart,
        messageCount: result.total ?? Math.max(baseline?.messageCount ?? 0, messages.length),
      };
      await saveCloudBaseline(conversationId, baseline);
      await acknowledgeCloudMessages(batch);
      fields = [];
    }
    const cursor = advancedCursor(this.cursors[cursorKey], pendingMessages);
    if (cursor) {
      this.cursors[cursorKey] = cursor;
      await browser.storage.local.set({ [CLOUD_SYNC_CURSOR_KEY]: this.cursors });
    }
    return true;
  }

  private async waitForRequestSlot(): Promise<void> {
    const waitMs = Math.max(
      0,
      this.lastRequestStartedAt + this.minRequestIntervalMs - Date.now(),
    );
    if (waitMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    }
    this.lastRequestStartedAt = Date.now();
  }

  private async clearSkipped(conversationId?: string): Promise<void> {
    const stored = await browser.storage.local.get([CLOUD_SKIPPED, CLOUD_BASELINES]);
    const skipped = (stored[CLOUD_SKIPPED] ?? {}) as SkippedConversationMap;
    const ids = conversationId ? (skipped[conversationId] ? [conversationId] : []) : Object.keys(skipped);
    if (!ids.length) return;
    const next = { ...skipped };
    const baselines = { ...((stored[CLOUD_BASELINES] ?? {}) as BaselineMap) };
    for (const id of ids) {
      delete next[id];
      // A server-side deletion is intentionally absent from download pages.
      // Its old baseline would otherwise make the retained local record look
      // clean and suppress the retry before /upload is called.
      delete baselines[id];
    }
    await browser.storage.local.set({ [CLOUD_SKIPPED]: next, [CLOUD_BASELINES]: baselines });
  }

  private async loadCursors(): Promise<void> {
    if (this.cursorsLoaded) return;
    const stored = await browser.storage.local.get(CLOUD_SYNC_CURSOR_KEY);
    this.cursors = normalizeCursorMap(stored[CLOUD_SYNC_CURSOR_KEY]);
    this.cursorsLoaded = true;
  }

  private async loadPending(): Promise<void> {
    if (this.loaded) return;
    this.loadingPending ??= (async () => {
      const stored = await browser.storage.local.get(CLOUD_SYNC_PENDING_KEY);
      const value = stored[CLOUD_SYNC_PENDING_KEY];
      this.pending = new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []);
      this.loaded = true;
    })();
    try { await this.loadingPending; } finally { this.loadingPending = null; }
  }

  private async persistPending(): Promise<void> {
    await browser.storage.local.set({ [CLOUD_SYNC_PENDING_KEY]: [...this.pending] });
  }

  private async publish(update: Partial<CloudSyncState>): Promise<void> {
    const stored = await browser.storage.local.get(['cloudSyncState', CLOUD_SKIPPED]);
    const current = stored.cloudSyncState as CloudSyncState | undefined;
    await saveCloudSyncState({
      ...DEFAULT_CLOUD_SYNC_STATE,
      ...current,
      ...update,
      pendingCount: this.pending.size,
      skippedConversations: Object.keys(stored[CLOUD_SKIPPED] ?? {}).length,
    });
  }
}

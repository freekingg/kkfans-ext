import type { ChatMessage, ConversationIdentity, ConversationRecord } from '../core/types';
import { conversationMessageTimes } from '../business/message-times';
import { reconcileMessageSources } from './cross-source-messages';
import {
  normalizeConversationPhone,
  normalizeConversationTitle,
} from '../whatsapp/conversation-identity';

const DATABASE_NAME = 'kkfans-whatsapp-toolkit';
const DATABASE_VERSION = 1;
const CONVERSATIONS = 'conversations';
const MESSAGES = 'messages';
const ORDER_GAP = 1024;

function legacyMessageOrder(a: ChatMessage, b: ChatMessage): number {
  return (
    (a.timestampMs ?? a.capturedAt) - (b.timestampMs ?? b.capturedAt) ||
    a.domOrder - b.domOrder ||
    a.id.localeCompare(b.id)
  );
}

function stableMessageOrder(a: ChatMessage, b: ChatMessage): number {
  if (Number.isFinite(a.orderIndex) && Number.isFinite(b.orderIndex)) {
    return (a.orderIndex as number) - (b.orderIndex as number) || a.id.localeCompare(b.id);
  }
  return legacyMessageOrder(a, b);
}

function messagesSemanticallyEqual(a: ChatMessage, b: ChatMessage): boolean {
  return (
    a.direction === b.direction &&
    a.kind === b.kind &&
    a.text === b.text &&
    a.quotedText === b.quotedText &&
    a.sender === b.sender &&
    a.timestampRaw === b.timestampRaw &&
    a.timestampMs === b.timestampMs &&
    a.mediaCount === b.mediaCount &&
    a.urls.length === b.urls.length &&
    a.urls.every((url, index) => url === b.urls[index])
  );
}

function seedExistingOrder(records: ChatMessage[]): void {
  const ordered = [...records].sort(stableMessageOrder);
  ordered.forEach((message, index) => {
    if (!Number.isFinite(message.orderIndex)) message.orderIndex = index * ORDER_GAP;
  });
}

function assignObservedOrder(existing: ChatMessage[], observed: ChatMessage[]): Map<string, number> {
  const assigned = new Map(existing.map((message) => [message.key, message.orderIndex as number]));
  if (observed.length === 0) return assigned;
  if (existing.length === 0) {
    observed.forEach((message, index) => assigned.set(message.key, index * ORDER_GAP));
    return assigned;
  }

  const anchors = observed
    .map((message, index) => ({ index, order: assigned.get(message.key) }))
    .filter((item): item is { index: number; order: number } => Number.isFinite(item.order));

  if (anchors.length === 0) {
    const existingOrdered = [...existing].sort(stableMessageOrder);
    const existingFirst = existingOrdered[0]!;
    const existingLast = existingOrdered.at(-1)!;
    const observedTimes = observed.map((message) => message.timestampMs).filter(Number.isFinite) as number[];
    const existingTimes = existing.map((message) => message.timestampMs).filter(Number.isFinite) as number[];
    const prepend =
      observedTimes.length > 0 &&
      existingTimes.length > 0 &&
      Math.max(...observedTimes) <= Math.min(...existingTimes);
    const start = prepend
      ? (existingFirst.orderIndex as number) - observed.length * ORDER_GAP
      : (existingLast.orderIndex as number) + ORDER_GAP;
    observed.forEach((message, index) => assigned.set(message.key, start + index * ORDER_GAP));
    return assigned;
  }

  const firstAnchor = anchors[0]!;
  for (let index = 0; index < firstAnchor.index; index += 1) {
    assigned.set(observed[index]!.key, firstAnchor.order - (firstAnchor.index - index) * ORDER_GAP);
  }

  for (let anchorIndex = 0; anchorIndex < anchors.length - 1; anchorIndex += 1) {
    const left = anchors[anchorIndex]!;
    const right = anchors[anchorIndex + 1]!;
    const distance = right.index - left.index;
    if (distance <= 1 || right.order <= left.order) continue;
    const step = (right.order - left.order) / distance;
    for (let index = left.index + 1; index < right.index; index += 1) {
      assigned.set(observed[index]!.key, left.order + step * (index - left.index));
    }
  }

  const lastAnchor = anchors.at(-1)!;
  for (let index = lastAnchor.index + 1; index < observed.length; index += 1) {
    assigned.set(observed[index]!.key, lastAnchor.order + (index - lastAnchor.index) * ORDER_GAP);
  }
  return assigned;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

let databasePromise: Promise<IDBDatabase> | null = null;

export function openMessageDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(CONVERSATIONS)) {
        const conversations = database.createObjectStore(CONVERSATIONS, { keyPath: 'id' });
        conversations.createIndex('updatedAt', 'updatedAt');
      }
      if (!database.objectStoreNames.contains(MESSAGES)) {
        const messages = database.createObjectStore(MESSAGES, { keyPath: 'key' });
        messages.createIndex('conversationId', 'conversationId');
        messages.createIndex('capturedAt', 'capturedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      databasePromise = null;
      reject(request.error ?? new Error('Unable to open IndexedDB'));
    };
  });
  return databasePromise;
}

export async function upsertMessages(
  identity: ConversationIdentity,
  messages: ChatMessage[],
): Promise<{ added: number; changed: number; total: number }> {
  const database = await openMessageDatabase();
  const transaction = database.transaction([CONVERSATIONS, MESSAGES], 'readwrite');
  const conversationStore = transaction.objectStore(CONVERSATIONS);
  const messageStore = transaction.objectStore(MESSAGES);
  const messageIndex = messageStore.index('conversationId');
  const existingConversation = (await requestToPromise(
    conversationStore.get(identity.id),
  )) as ConversationRecord | undefined;
  const existingMessages = (await requestToPromise(
    messageIndex.getAll(identity.id),
  )) as ChatMessage[];
  const missingOrderKeys = new Set(
    existingMessages.filter((message) => !Number.isFinite(message.orderIndex)).map((message) => message.key),
  );
  seedExistingOrder(existingMessages);
  messages = reconcileMessageSources(existingMessages, messages);
  const existingByKey = new Map(existingMessages.map((message) => [message.key, message]));
  const assignedOrder = assignObservedOrder(existingMessages, messages);
  for (const existing of existingMessages) {
    if (missingOrderKeys.has(existing.key)) messageStore.put(existing);
  }

  let added = 0;
  let changed = 0;
  for (const message of messages) {
    const existing = existingByKey.get(message.key);
    if (!existing) added += 1;
    const orderIndex = assignedOrder.get(message.key);
    const merged: ChatMessage = {
      ...message,
      capturedAt: existing?.capturedAt ?? message.capturedAt,
      domOrder: existing?.domOrder ?? message.domOrder,
      ...(orderIndex === undefined ? {} : { orderIndex }),
    };
    const semanticChanged = Boolean(existing && !messagesSemanticallyEqual(existing, merged));
    merged.cloudSynced = !semanticChanged && existing?.cloudSynced === true;
    if (semanticChanged) merged.capturedAt = message.capturedAt;
    const orderChanged = Boolean(existing && existing.orderIndex !== merged.orderIndex);
    if (semanticChanged) changed += 1;
    existingByKey.set(message.key, merged);
    const aliasesChanged = JSON.stringify(existing?.sourceAliases ?? []) !== JSON.stringify(merged.sourceAliases ?? []);
    if (!existing || semanticChanged || orderChanged || aliasesChanged) messageStore.put(merged);
  }

  const allMessages = [...existingByKey.values()].sort(stableMessageOrder);
  const total = allMessages.length;
  if (!existingConversation || added > 0 || changed > 0 || existingConversation.firstMessageAt === undefined) {
    const now = Date.now();
    const record: ConversationRecord = {
      ...existingConversation,
      ...identity,
      ...conversationMessageTimes(allMessages, existingConversation?.historyStart),
      createdAt: existingConversation?.createdAt ?? now,
      updatedAt: now,
      lastCapturedAt: now,
      messageCount: total,
      oldestMessageId: allMessages[0]?.id ?? existingConversation?.oldestMessageId ?? null,
      newestMessageId: allMessages.at(-1)?.id ?? existingConversation?.newestMessageId ?? null,
    };
    conversationStore.put(record);
  }
  await transactionDone(transaction);
  return { added, changed, total };
}

export async function listConversations(): Promise<ConversationRecord[]> {
  const database = await openMessageDatabase();
  const transaction = database.transaction(CONVERSATIONS, 'readonly');
  const records = (await requestToPromise(
    transaction.objectStore(CONVERSATIONS).getAll(),
  )) as ConversationRecord[];
  await transactionDone(transaction);
  return records.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Recovery does not create new capture timestamps or enqueue uploads. */
export async function importCloudConversations(records: ConversationRecord[]): Promise<void> {
  const db = await openMessageDatabase();
  const tx = db.transaction(CONVERSATIONS, 'readwrite');
  const store = tx.objectStore(CONVERSATIONS);
  for (const remote of records) {
    const current = await requestToPromise(store.get(remote.id)) as ConversationRecord | undefined;
    const minTime = (a?: number | null, b?: number | null) => a == null ? b : b == null ? a : Math.min(a, b);
    const maxTime = (a?: number | null, b?: number | null) => a == null ? b : b == null ? a : Math.max(a, b);
    store.put(current ? {
      ...remote, ...current,
      createdAt: Math.min(current.createdAt, remote.createdAt), updatedAt: Math.max(current.updatedAt, remote.updatedAt),
      firstMessageAt: minTime(current.firstMessageAt, remote.firstMessageAt), lastMessageAt: maxTime(current.lastMessageAt, remote.lastMessageAt),
      historyStart: current.historyStart === undefined ? remote.historyStart : current.historyStart,
      messageCount: Math.max(current.messageCount, remote.messageCount),
    } : remote);
  }
  await transactionDone(tx);
}

export async function importCloudMessages(messages: ChatMessage[]): Promise<void> {
  const db = await openMessageDatabase();
  const tx = db.transaction([CONVERSATIONS, MESSAGES], 'readwrite');
  const store = tx.objectStore(MESSAGES);
  const affected = new Set<string>();
  for (const message of messages) {
    const key = `${message.conversationId}:${message.id}`;
    const previous = await requestToPromise(store.get(key)) as ChatMessage | undefined;
    // An unsynced local edit always wins over a delayed cloud page.
    if (previous && !previous.cloudSynced && !messagesSemanticallyEqual(previous, message)) continue;
    store.put({ ...message, key, cloudSynced: true, ...(previous?.sourceAliases ? { sourceAliases: previous.sourceAliases } : {}), ...(previous?.orderIndex === undefined ? {} : { orderIndex: previous.orderIndex }) });
    affected.add(message.conversationId);
  }
  for (const id of affected) {
    const record = await requestToPromise(tx.objectStore(CONVERSATIONS).get(id)) as ConversationRecord | undefined;
    if (!record) continue;
    const all = await requestToPromise(store.index('conversationId').getAll(id)) as ChatMessage[];
    tx.objectStore(CONVERSATIONS).put({ ...record,
      messageCount: Math.max(record.messageCount, all.length),
      hasHistoryStart: conversationMessageTimes(all, record.historyStart).hasHistoryStart,
    });
  }
  await transactionDone(tx);
}

/** Acknowledge exactly the sent snapshot, never a newer edit made in flight. */
export async function acknowledgeCloudMessages(messages: ChatMessage[]): Promise<void> {
  if (!messages.length) return;
  const db = await openMessageDatabase();
  const tx = db.transaction(MESSAGES, 'readwrite');
  const store = tx.objectStore(MESSAGES);
  for (const sent of messages) {
    const current = await requestToPromise(store.get(sent.key)) as ChatMessage | undefined;
    if (current && messagesSemanticallyEqual(current, sent)) store.put({ ...current, cloudSynced: true });
  }
  await transactionDone(tx);
}

export async function mergeConversationAliases(
  identity: ConversationIdentity,
): Promise<{ aliasIds: string[]; total: number }> {
  const phone = normalizeConversationPhone(identity.title);

  const database = await openMessageDatabase();
  const transaction = database.transaction([CONVERSATIONS, MESSAGES], 'readwrite');
  const conversationStore = transaction.objectStore(CONVERSATIONS);
  const messageStore = transaction.objectStore(MESSAGES);
  const messageIndex = messageStore.index('conversationId');
  const conversations = (await requestToPromise(
    conversationStore.getAll(),
  )) as ConversationRecord[];
  const matching = phone
    ? conversations.filter(
        (record) => record.id === identity.id || normalizeConversationPhone(record.title) === phone,
      )
    : conversations.filter(
        (record) =>
          normalizeConversationTitle(record.title).toLocaleLowerCase() ===
          normalizeConversationTitle(identity.title).toLocaleLowerCase(),
      );
  const possibleAliasIds = matching
    .map((record) => record.id)
    .filter((conversationId) => conversationId !== identity.id);
  const aliasIds = phone || possibleAliasIds.length === 1
    ? possibleAliasIds
    : [];
  if (!aliasIds.length) {
    const current = matching.find((record) => record.id === identity.id);
    await transactionDone(transaction);
    return { aliasIds: [], total: current?.messageCount ?? 0 };
  }

  const sourceIds = [...aliasIds, identity.id];
  const sourceMessages: ChatMessage[] = [];
  for (const conversationId of sourceIds) {
    sourceMessages.push(...((await requestToPromise(
      messageIndex.getAll(conversationId),
    )) as ChatMessage[]));
  }

  const byMessageId = new Map<string, ChatMessage>();
  for (const message of sourceMessages) {
    const previous = byMessageId.get(message.id);
    if (!previous || message.capturedAt >= previous.capturedAt) {
      byMessageId.set(message.id, message);
    }
    messageStore.delete(message.key);
  }
  const mergedMessages = [...byMessageId.values()]
    .map((message) => ({
      ...message,
      key: `${identity.id}:${message.id}`,
      conversationId: identity.id,
    }))
    .sort(stableMessageOrder);
  mergedMessages.forEach((message) => messageStore.put(message));

  const now = Date.now();
  const current = matching.find((record) => record.id === identity.id);
  const historyStart = matching.map((item) => item.historyStart).find((start) =>
    start && mergedMessages.some((message) => message.id === start.messageId)) ?? current?.historyStart;
  const record: ConversationRecord = {
    ...identity,
    ...(historyStart !== undefined ? { historyStart } : {}),
    ...conversationMessageTimes(mergedMessages, historyStart),
    createdAt: matching.length
      ? Math.min(...matching.map((item) => item.createdAt))
      : now,
    updatedAt: matching.length
      ? Math.max(...matching.map((item) => item.updatedAt))
      : now,
    lastCapturedAt: matching
      .map((item) => item.lastCapturedAt)
      .filter((value): value is number => Number.isFinite(value))
      .reduce<number | null>((latest, value) => latest == null ? value : Math.max(latest, value), null),
    messageCount: mergedMessages.length,
    oldestMessageId: mergedMessages[0]?.id ?? current?.oldestMessageId ?? null,
    newestMessageId: mergedMessages.at(-1)?.id ?? current?.newestMessageId ?? null,
  };
  aliasIds.forEach((conversationId) => conversationStore.delete(conversationId));
  conversationStore.put(record);
  await transactionDone(transaction);
  return { aliasIds, total: mergedMessages.length };
}

export async function listMessages(conversationId: string, limit = 200): Promise<ChatMessage[]> {
  const records = await listAllMessages(conversationId);
  return records.slice(-Math.max(1, limit));
}

export async function setHistoryStart(
  conversationId: string,
  historyStart: NonNullable<ConversationRecord['historyStart']>,
): Promise<boolean> {
  if (!historyStart.messageId || historyStart.messageId.length > 160 ||
    !Number.isSafeInteger(historyStart.detectedAt) || historyStart.detectedAt < 0) {
    throw new Error('历史起点信息无效');
  }
  const database = await openMessageDatabase();
  const transaction = database.transaction([CONVERSATIONS, MESSAGES], 'readwrite');
  const store = transaction.objectStore(CONVERSATIONS);
  const conversation = await requestToPromise(store.get(conversationId)) as ConversationRecord | undefined;
  const message = await requestToPromise(transaction.objectStore(MESSAGES).get(
    `${conversationId}:${historyStart.messageId}`,
  )) as ChatMessage | undefined;
  const valid = conversation && message?.conversationId === conversationId &&
    message.direction !== 'unknown' && message.kind !== 'system';
  const changed = Boolean(valid && conversation.historyStart?.messageId !== historyStart.messageId);
  if (changed) {
    const messages = await requestToPromise(transaction.objectStore(MESSAGES).index('conversationId').getAll(conversationId)) as ChatMessage[];
    store.put({ ...conversation, historyStart, ...conversationMessageTimes(messages, historyStart) });
  }
  await transactionDone(transaction);
  if (!valid) throw new Error('历史起点消息尚未保存，请重新补齐历史');
  return changed;
}

export async function listAllMessages(conversationId: string): Promise<ChatMessage[]> {
  const database = await openMessageDatabase();
  const transaction = database.transaction(MESSAGES, 'readonly');
  const index = transaction.objectStore(MESSAGES).index('conversationId');
  const records = (await requestToPromise(index.getAll(conversationId))) as ChatMessage[];
  await transactionDone(transaction);
  return records.sort(stableMessageOrder);
}

export async function listMessageKeys(conversationId: string): Promise<string[]> {
  const database = await openMessageDatabase();
  const transaction = database.transaction(MESSAGES, 'readonly');
  const index = transaction.objectStore(MESSAGES).index('conversationId');
  const keys = await requestToPromise(index.getAllKeys(IDBKeyRange.only(conversationId)));
  await transactionDone(transaction);
  return keys.map(String);
}

export async function clearConversationMessages(conversationId: string): Promise<number> {
  const database = await openMessageDatabase();
  const transaction = database.transaction([CONVERSATIONS, MESSAGES], 'readwrite');
  const conversationStore = transaction.objectStore(CONVERSATIONS);
  const messageStore = transaction.objectStore(MESSAGES);
  const index = messageStore.index('conversationId');
  const keys = await requestToPromise(index.getAllKeys(IDBKeyRange.only(conversationId)));
  keys.forEach((key) => messageStore.delete(key));
  const conversation = (await requestToPromise(
    conversationStore.get(conversationId),
  )) as ConversationRecord | undefined;
  if (conversation) {
    conversationStore.put({
      ...conversation,
      updatedAt: Date.now(),
      lastCapturedAt: null,
      messageCount: 0,
      oldestMessageId: null,
      newestMessageId: null,
      historyStart: null,
      firstMessageAt: null,
      lastMessageAt: null,
      hasHistoryStart: false,
    });
  }
  await transactionDone(transaction);
  return keys.length;
}

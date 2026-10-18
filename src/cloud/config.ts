const configuredBaseUrl = String(
  (import.meta.env as Record<string, unknown>).WXT_CLOUD_API_BASE_URL ?? '',
).trim();

export const CLOUD_API_BASE_URL = (
  configuredBaseUrl ||
  (import.meta.env.DEV ? 'http://127.0.0.1:3333' : 'https://kkfans.lllin.fun')
).replace(/\/+$/, '');

export const CLOUD_SYNC_ALARM = 'kkfans-whatsapp-cloud-sync';
export const CLOUD_SYNC_PENDING_KEY = 'cloudSyncPendingConversations';
export const CLOUD_SYNC_CURSOR_KEY = 'cloudSyncMessageCursors';
export const CLOUD_SYNC_BATCH_SIZE = 200;
export const CLOUD_SYNC_MIN_REQUEST_INTERVAL_MS = 1100;
export const CLOUD_SYNC_RATE_LIMIT_FALLBACK_MS = 65_000;

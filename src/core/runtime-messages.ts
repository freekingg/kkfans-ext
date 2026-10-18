import type {
  ActiveContext,
  CaptureState,
  ChatMessage,
  ConversationIdentity,
  ConversationRecord,
  CloudSyncState,
} from './types';

export type BackgroundRequest =
  | {
      type: 'db:upsert-messages';
      conversation: ConversationIdentity;
      messages: ChatMessage[];
    }
  | { type: 'db:list-conversations' }
  | { type: 'db:set-history-start'; conversationId: string; historyStart: NonNullable<ConversationRecord['historyStart']> }
  | { type: 'db:resolve-conversation'; conversation: ConversationIdentity }
  | { type: 'db:list-messages'; conversationId: string; limit: number }
  | { type: 'db:list-message-keys'; conversationId: string }
  | { type: 'db:clear-conversation-messages'; conversationId: string }
  | { type: 'capture:publish-state'; state: CaptureState }
  | { type: 'cloud:sync-all' }
  | { type: 'cloud:report'; conversationId: string }
  | { type: 'cloud:resolve-conflicts'; choice: 'local' | 'cloud' };

export type BackgroundResponse =
  | { ok: true; added: number; changed: number; total: number }
  | { ok: true; conversations: ConversationRecord[] }
  | { ok: true; aliasIds: string[]; total: number }
  | { ok: true; messages: ChatMessage[] }
  | { ok: true; messageKeys: string[] }
  | { ok: true; removed: number }
  | { ok: true; syncState: CloudSyncState }
  | { ok: true }
  | { ok: false; error: string };

export type ContentCommand =
  | { type: 'content:get-context' }
  | { type: 'content:start-capture' }
  | { type: 'content:pause-capture' }
  | { type: 'content:cancel-capture' }
  | { type: 'content:refresh-tags' };

export type ContentResponse =
  | { ok: true; context: ActiveContext }
  | { ok: true }
  | { ok: false; error: string };

export function isContentCommand(value: unknown): value is ContentCommand {
  if (!value || typeof value !== 'object' || !('type' in value)) return false;
  return typeof value.type === 'string' && value.type.startsWith('content:');
}

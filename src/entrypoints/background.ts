import { browser } from 'wxt/browser';
import type { BackgroundRequest, BackgroundResponse } from '../core/runtime-messages';
import { CLOUD_SYNC_ALARM } from '../cloud/config';
import {
  DEFAULT_AI_SETTINGS,
  DEFAULT_CAPTURE_SETTINGS,
  DEFAULT_SOP_SETTINGS,
  DEFAULT_TAGS,
  migrateTagSettings,
} from '../storage/settings';
import {
  clearConversationMessages,
  listConversations,
  listMessageKeys,
  listMessages,
  mergeConversationAliases,
  upsertMessages,
  setHistoryStart,
} from '../storage/message-db';
import { mergeConversationStorageAliases } from '../storage/settings';
import { mergeAiChatSessionAliases } from '../storage/ai-chat-store';
import { migrateCloudAliases } from '../cloud/cloud-recovery';
import { respondToRuntimeMessage } from '../core/runtime-response';
import { publishConversationMatchIndex, readConversationMatchIndex } from '../storage/conversation-match-index';
import { resolveConversationIdentity } from '../whatsapp/conversation-identity';

const CAPTURE_STATE_KEY = 'captureState';

async function handleRequest(
  request: BackgroundRequest,
): Promise<BackgroundResponse> {
  try {
    if (request.type === 'db:upsert-messages' || request.type === 'db:resolve-conversation') {
      const index = await readConversationMatchIndex();
      const identity = resolveConversationIdentity(request.conversation, index.username, index.conversations);
      if (identity?.id !== request.conversation.id) {
        await publishConversationMatchIndex();
        return { ok: false, error: '联系人匹配已更新，请稍候重试，未写入消息' };
      }
    }
    switch (request.type) {
      case 'db:set-history-start': {
        await setHistoryStart(request.conversationId, request.historyStart);
        return { ok: true };
      }
      case 'db:upsert-messages': {
        const result = await upsertMessages(request.conversation, request.messages);
        await publishConversationMatchIndex();
        return { ok: true, ...result };
      }
      case 'db:list-conversations':
        return { ok: true, conversations: await listConversations() };
      case 'db:resolve-conversation': {
        const result = await mergeConversationAliases(request.conversation);
        const storageAliasIds = await mergeConversationStorageAliases(
          request.conversation,
          result.aliasIds,
        );
        if (storageAliasIds.length) {
          await migrateCloudAliases(request.conversation.id, storageAliasIds);
          await mergeAiChatSessionAliases(request.conversation.id, storageAliasIds);
        }
        await publishConversationMatchIndex();
        return { ok: true, ...result, aliasIds: storageAliasIds };
      }
      case 'db:list-messages':
        return {
          ok: true,
          messages: await listMessages(request.conversationId, request.limit),
        };
      case 'db:list-message-keys':
        return {
          ok: true,
          messageKeys: await listMessageKeys(request.conversationId),
        };
      case 'db:clear-conversation-messages': {
        const removed = await clearConversationMessages(request.conversationId);
        return { ok: true, removed };
      }
      case 'capture:publish-state':
        await browser.storage.local.set({ [CAPTURE_STATE_KEY]: request.state });
        return { ok: true };
      case 'cloud:sync-all':
      case 'cloud:report':
      case 'cloud:resolve-conflicts':
        return { ok: false, error: '当前版本仅本地保存，已停用云端同步与上报' };
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '后台处理失败' };
  }
}

export default defineBackground(() => {
  void migrateTagSettings().then(() => publishConversationMatchIndex());
  // Stop timers left by older versions without deleting any saved data or queue.
  void browser.alarms.clear(CLOUD_SYNC_ALARM);
  void browser.alarms.clear('kkfans-whatsapp-cloud-pull');
  const sidePanel = browser.sidePanel;
  if (sidePanel?.setPanelBehavior) {
    void sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }

  browser.runtime.onInstalled.addListener(() => {
    void (async () => {
      const existing = await browser.storage.local.get([
        'tagDefinitions',
        'conversationTags',
        'conversationNotes',
        'cooperationProfiles',
        'conversationSopStages',
        'conversationSopStageHistory',
        'captureSettings',
        'cloudSettings',
        'aiSettings',
        'sopSettings',
      ]);
      await browser.storage.local.set({
        tagDefinitions: existing.tagDefinitions ?? DEFAULT_TAGS,
        conversationTags: existing.conversationTags ?? {},
        conversationNotes: existing.conversationNotes ?? {},
        cooperationProfiles: existing.cooperationProfiles ?? {},
        conversationSopStages: existing.conversationSopStages ?? {},
        conversationSopStageHistory: existing.conversationSopStageHistory ?? [],
        captureSettings: existing.captureSettings ?? DEFAULT_CAPTURE_SETTINGS,
        cloudSettings: existing.cloudSettings ?? { username: '', whatsappAccount: '' },
        aiSettings: existing.aiSettings ?? DEFAULT_AI_SETTINGS,
        sopSettings: existing.sopSettings ?? DEFAULT_SOP_SETTINGS,
      });
      await migrateTagSettings();
    })();
  });

  browser.storage.onChanged.addListener((changes) => {
    if (changes.cloudRestoreApplied || changes.cooperationProfiles || changes.cloudSettings) {
      void publishConversationMatchIndex();
    }
  });

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== 'object' || !('type' in message)) return undefined;
    const type = String(message.type);
    if (
      !type.startsWith('db:') &&
      !type.startsWith('capture:publish') &&
      !type.startsWith('cloud:')
    ) {
      return undefined;
    }
    return respondToRuntimeMessage<BackgroundResponse>(() => handleRequest(message as BackgroundRequest), sendResponse);
  });
});

import { browser } from 'wxt/browser';
import { listConversations } from './message-db';
import { getCloudSettings, getCooperationProfiles } from './settings';
import { CONVERSATION_MATCH_INDEX, type ConversationMatchIndex } from '../whatsapp/conversation-identity';

export async function readConversationMatchIndex(): Promise<ConversationMatchIndex> {
  const [settings, records, profiles] = await Promise.all([getCloudSettings(), listConversations(), getCooperationProfiles()]);
  return { username: settings.username.trim(), conversations: records.sort((a, b) => a.id.localeCompare(b.id)).map(({ id, title }) => ({
    id, title, ...(profiles[id]?.contactWhatsapp ? { contactWhatsapp: profiles[id].contactWhatsapp } : {}),
  })) };
}

let publishing: Promise<ConversationMatchIndex> | null = null;
let dirty = false;
/** Publish only when identities change. Message uploads/hover never reload DOM metadata. */
export async function publishConversationMatchIndex(): Promise<ConversationMatchIndex> {
  dirty = true;
  if (!publishing) {
    publishing = (async () => {
      let next: ConversationMatchIndex;
      do {
        dirty = false;
        next = await readConversationMatchIndex();
        const stored = (await browser.storage.local.get(CONVERSATION_MATCH_INDEX))[CONVERSATION_MATCH_INDEX];
        if (JSON.stringify(stored) !== JSON.stringify(next)) await browser.storage.local.set({ [CONVERSATION_MATCH_INDEX]: next });
      } while (dirty);
      return next!;
    })().finally(() => { publishing = null; });
  }
  return publishing;
}

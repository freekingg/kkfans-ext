import { isMetaHost, isMetaWhatsAppPage } from '../platforms/page-target';
import { metaSelectors } from '../meta-inbox/dom';

const webSelectors = {
  app: '#app',
  chatList: '#pane-side',
  chatRows: '#pane-side [role="row"]',
  chatRowTitle: '[data-testid="cell-frame-title"]',
  chatRowPreview: '[data-testid="cell-frame-secondary"]',
  main: '#main',
  conversationHeader: '[data-testid="conversation-header"]',
  conversationTitle: '[data-testid="conversation-info-header-chat-title"]',
  messageScroller: '[data-testid="conversation-panel-messages"]',
  messageContainers: '[data-testid="msg-container"]',
  messageWrapper: '[data-testid^="conv-msg-"]',
  selectableText: '[data-testid="selectable-text"]',
  quotedMessage: '[data-testid="quoted-message"]',
  linkPreview: '[data-testid="link-preview-container"]',
  composer: '[data-testid="conversation-compose-box-input"]',
  incomingTail: '[data-icon="tail-in"]',
  outgoingTail: '[data-icon="tail-out"]',
  incomingMessage: '.message-in, [data-testid="msg-in"]',
  outgoingMessage: '.message-out, [data-testid="msg-out"]',
} as const;

// One content-script instance belongs to one host; SPA channel changes are
// guarded separately and never turn Messenger/Instagram into WhatsApp.
export const selectors: Record<keyof typeof webSelectors, string> = isMetaHost()
  ? { ...webSelectors, ...metaSelectors } : webSelectors;

export function queryConversationMain(): HTMLElement | null {
  if (isMetaHost() && !isMetaWhatsAppPage()) return null;
  return document.querySelector<HTMLElement>(selectors.main);
}

export function queryMessageScroller(root: ParentNode = document): HTMLElement | null {
  if (isMetaHost()) {
    if (!isMetaWhatsAppPage()) return null;
    const main = root === document ? queryConversationMain() : root;
    return main?.querySelector<HTMLElement>(selectors.messageScroller) ?? null;
  }
  return root.querySelector<HTMLElement>(selectors.messageScroller);
}

export function selectorHealth() {
  if (isMetaHost() && !isMetaWhatsAppPage()) return { chatList: false, main: false, messageScroller: false, composer: false };
  return {
    chatList: Boolean(document.querySelector(selectors.chatList)),
    main: Boolean(document.querySelector(selectors.main)),
    messageScroller: Boolean(document.querySelector(selectors.messageScroller)),
    composer: Boolean(document.querySelector(selectors.composer)),
  };
}

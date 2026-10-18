/** Both surfaces represent the same WhatsApp contacts, not separate accounts. */
export const CHAT_PAGE_MATCHES = ['https://web.whatsapp.com/*', 'https://business.facebook.com/*'];

export function isMetaHost(url = typeof location === 'undefined' ? '' : location.href): boolean {
  try { return new URL(url).hostname === 'business.facebook.com'; } catch { return false; }
}

export function isMetaWhatsAppPage(url = typeof location === 'undefined' ? '' : location.href): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'business.facebook.com' && /^\/latest\/inbox\/wec\/?$/.test(parsed.pathname)
      && (!parsed.searchParams.has('thread_type') || parsed.searchParams.get('thread_type') === 'WEC_MESSAGE');
  } catch { return false; }
}

export function isChatPage(url: string): boolean {
  try { return new URL(url).hostname === 'web.whatsapp.com' || isMetaWhatsAppPage(url); } catch { return false; }
}

/** A page-local switch guard only. Never use Meta's thread ID as a contact ID. */
export function pageConversationToken(): string {
  if (!isMetaHost()) return '';
  if (!isMetaWhatsAppPage()) return 'unsupported';
  const url = new URL(location.href);
  return [url.searchParams.get('asset_id'), url.searchParams.get('selected_item_id')].join(':');
}

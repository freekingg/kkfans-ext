import { afterEach, describe, expect, it, vi } from 'vitest';
import { isChatPage, isMetaWhatsAppPage } from './page-target';
afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
describe('shared WhatsApp surfaces', () => {
  it('allows WhatsApp only, not Messenger or Instagram', () => {
    expect(isChatPage('https://web.whatsapp.com/')).toBe(true);
    expect(isMetaWhatsAppPage('https://business.facebook.com/latest/inbox/wec?thread_type=WEC_MESSAGE')).toBe(true);
    expect(isChatPage('https://business.facebook.com/latest/inbox/messenger')).toBe(false);
    expect(isChatPage('https://business.facebook.com/latest/inbox/wec?thread_type=IG_MESSAGE')).toBe(false);
    expect(isChatPage('https://business.facebook.com.evil.test/latest/inbox/wec')).toBe(false);
  });
  it('uses the header title with the same contact ID as Web, ignoring right-side numbers', async () => {
    vi.resetModules();
    vi.stubGlobal('location', new URL('https://business.facebook.com/latest/inbox/wec?selected_item_id=meta-thread'));
    const identity = await import('../whatsapp/conversation-identity');
    identity.setIdentityUsername('operator');
    document.body.innerHTML = `<span data-surface="/lib:inbox:detail_column"><span data-surface="/lib:inbox:detail_view_header"><div class="_4ik4">Wynn ken</div></span><div role="region" aria-label="messages" tabindex="0"></div></span><aside>+44 1234567890</aside>`;
    const webIdentity = identity.identityFromConversationData({ title: 'Wynn ken', avatarKey: null }, 'operator');
    expect(identity.getActiveConversationIdentity()?.id).toBe(webIdentity?.id);
    identity.setConversationMatchIndex({ username: 'operator', conversations: [{ id: 'cloud-existing', title: 'Wynn ken', contactWhatsapp: '+441234567890' }] });
    expect(identity.getActiveConversationIdentity()?.id).toBe('cloud-existing');
    vi.stubGlobal('location', new URL('https://business.facebook.com/latest/inbox/instagram_direct'));
    expect(identity.getActiveConversationIdentity()).toBeNull();
  });
});

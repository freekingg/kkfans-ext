import { beforeEach, describe, expect, it } from 'vitest';
import { getActiveConversationIdentity, identityFromChatRow, identityFromConversationData, normalizeConversationPhone } from './conversation-identity';

describe('conversation identity', () => {
  it('uses operator and contact name, not the avatar, when no phone is exposed', () => {
    const source = { title: ' Palafox ', avatarKey: 'https://example.com/old.jpg' };
    const first = identityFromConversationData(source, 'kkflow')!;
    expect(first.id).toBe('chat_v2_e8bfbb64b33ecc61');
    expect(identityFromConversationData({ title: 'Palafox', avatarKey: 'https://example.com/new.jpg' }, 'kkflow')?.id).toBe(first.id);
    expect(identityFromConversationData(source, 'kkflow01')?.id).not.toBe(first.id);
    expect(identityFromConversationData({ ...source, title: 'Other contact' }, 'kkflow')?.id).not.toBe(first.id);
  });

  it('normalizes real phone numbers without interpreting digits in usernames as phones', () => {
    const first = identityFromConversationData({ title: '+52 (155) 4720-5007', avatarKey: null }, 'kkflow')!;
    expect(identityFromConversationData({ title: '5215547205007', avatarKey: null }, 'kkflow')?.id).toBe(first.id);
    expect(normalizeConversationPhone('creator123456789')).toBeNull();
    expect(normalizeConversationPhone('+52 1 55 4720 5007')).toBe('525547205007');
    expect(identityFromConversationData({ title: '+52 1 55 4720 5007', avatarKey: null }, 'kkflow')?.id)
      .toBe(identityFromConversationData({ title: '+52 55 4720 5007', avatarKey: null }, 'kkflow')?.id);
  });
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('uses the matching chat row avatar for the active conversation', () => {
    document.body.innerHTML = `
      <div id="pane-side">
        <div role="row">
          <img src="https://cdn.example.com/avatar.jpg?token=temporary" />
          <div data-testid="cell-frame-title" title="  Partner   Name "></div>
        </div>
      </div>
      <div id="main">
        <header data-testid="conversation-header">
          <span data-testid="conversation-info-header-chat-title" title="Partner Name"></span>
        </header>
      </div>
    `;
    const row = document.querySelector('[role="row"]')!;
    expect(getActiveConversationIdentity()).toEqual(identityFromChatRow(row));
  });

  it('returns null when no chat is selected', () => {
    document.body.innerHTML = '<div id="pane-side"></div>';
    expect(getActiveConversationIdentity()).toBeNull();
  });

  it('falls back to textContent when WhatsApp Business exposes empty innerText', () => {
    document.body.innerHTML = `
      <div id="pane-side">
        <div role="row">
          <img src="https://cdn.example.com/business.jpg" />
          <div data-testid="cell-frame-title"><span>Business Partner</span></div>
        </div>
      </div>
    `;
    const title = document.querySelector<HTMLElement>('[data-testid="cell-frame-title"]')!;
    Object.defineProperty(title, 'innerText', { configurable: true, value: '' });

    expect(identityFromChatRow(document.querySelector('[role="row"]')!)).toMatchObject({
      title: 'Business Partner',
    });
  });

  it('keeps phone-number conversations stable when the avatar URL changes', () => {
    document.body.innerHTML = `
      <div role="row" id="first">
        <img src="https://cdn.example.com/old-avatar.jpg" />
        <div data-testid="cell-frame-title" title="+52 1 55 4720 5007"></div>
      </div>
      <div role="row" id="second">
        <img src="https://cdn.example.com/new-avatar.jpg" />
        <div data-testid="cell-frame-title" title="+52 1 55 4720 5007"></div>
      </div>
    `;

    expect(identityFromChatRow(document.querySelector('#first')!)?.id)
      .toBe(identityFromChatRow(document.querySelector('#second')!)?.id);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { identityFromConversationData, identityFromChatRow, resolveConversationIdentity, setConversationMatchIndex, setIdentityUsername, refreshVisibleContactConflicts, getActiveConversationIdentity, getActiveConversationMatchError } from './conversation-identity';

const known = [{ id: 'saved-local-id', title: '+52 1 55 4720 5007' }];
describe('contact last-five matching without rewriting saved IDs', () => {
  afterEach(() => { setConversationMatchIndex(null); setIdentityUsername(''); document.body.innerHTML = ''; refreshVisibleContactConflicts(); });

  it('reuses the saved ID despite a different phone prefix and keeps the captured title', () => {
    expect(resolveConversationIdentity({ title: '+52 55 4720 5007', avatarKey: null }, 'king', known))
      .toMatchObject({ id: 'saved-local-id', title: '+52 55 4720 5007' });
  });

  it('does not invent a new shortened ID when there is no saved contact', () => {
    const source = { title: '+52 55 4720 5007', avatarKey: null };
    expect(resolveConversationIdentity(source, 'king', [])).toEqual(identityFromConversationData(source, 'king'));
  });

  it('prefers an exact full number when different contacts share the same last five digits', () => {
    expect(resolveConversationIdentity({ title: known[0]!.title, avatarKey: null }, 'king',
      [...known, { id: 'other-person', title: '+1 202 000 5007' }])?.id).toBe('saved-local-id');
  });

  it('uses captured names when no phone is available, not digits embedded in names', () => {
    expect(resolveConversationIdentity({ title: ' Palafox ', avatarKey: null }, 'king',
      [{ id: 'saved-name', title: 'palafox' }])?.id).toBe('saved-name');
    expect(resolveConversationIdentity({ title: 'creator5007', avatarKey: null }, 'king', known)?.id).not.toBe('saved-local-id');
  });

  it('can match a known named contact by its cooperation-profile phone', () => {
    expect(resolveConversationIdentity({ title: '+52 55 4720 5007', avatarKey: null }, 'king',
      [{ id: 'named-id', title: 'Palafox', contactWhatsapp: '+52 1 55 4720 5007' }])?.id).toBe('named-id');
  });

  it('applies the cached index to chat rows only in the configured operator space', () => {
    document.body.innerHTML = '<div role="row"><span data-testid="cell-frame-title" title="+52 55 4720 5007"></span></div>';
    const row = document.querySelector('[role="row"]')!;
    setIdentityUsername('king');
    setConversationMatchIndex({ username: 'king', conversations: known });
    expect(identityFromChatRow(row)?.id).toBe('saved-local-id');
    setIdentityUsername('other');
    expect(identityFromChatRow(row)?.id).not.toBe('saved-local-id');
  });

  it('keeps two visible full numbers separate when their last five digits collide', () => {
    document.body.innerHTML = `<div id="pane-side">
      <div role="row"><span data-testid="cell-frame-title" title="+52 1 55 4720 5007"></span></div>
      <div role="row"><span data-testid="cell-frame-title" title="+1 202 000 5007"></span></div>
      </div><div id="main"><header data-testid="conversation-header"><span data-testid="conversation-info-header-chat-title" title="+52 1 55 4720 5007"></span></header></div>`;
    setIdentityUsername('king'); setConversationMatchIndex({ username: 'king', conversations: known });
    expect(getActiveConversationIdentity()?.id).toBe('saved-local-id');
    expect(getActiveConversationMatchError()).toBeNull();
    const rows = [...document.querySelectorAll('[role="row"]')].map(identityFromChatRow);
    expect(rows[0]?.id).toBe('saved-local-id');
    expect(rows[1]?.id).not.toBe('saved-local-id');
  });
});

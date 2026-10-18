import { waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationNoteMap, ConversationTagMap } from '../core/types';

const mocks = vi.hoisted(() => ({
  onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
  getTagDefinitions: vi.fn(),
  getConversationTags: vi.fn(),
  getConversationSopStages: vi.fn(),
  getConversationNotes: vi.fn(),
  getCooperationProfiles: vi.fn(),
}));

vi.mock('wxt/browser', () => ({ browser: { storage: { onChanged: mocks.onChanged } } }));
vi.mock('../storage/settings', () => ({
  getTagDefinitions: mocks.getTagDefinitions,
  getConversationTags: mocks.getConversationTags,
  getConversationSopStages: mocks.getConversationSopStages,
  getConversationNotes: mocks.getConversationNotes,
  getCooperationProfiles: mocks.getCooperationProfiles,
}));

// Exercise real identity hashing: a fixed identity mock hides recycled-row bugs.
import { identityFromConversationData, identityFromChatRow } from '../whatsapp/conversation-identity';
import { ChatTagRenderer } from './chat-tag-renderer';

const firstId = identityFromConversationData({ title: 'Palafox', avatarKey: null })!.id;
const secondId = identityFromConversationData({ title: '+527296873339', avatarKey: null })!.id;
const hostSelector = '[data-kkfans-tag-host]';
const fixture = `
  <div id="app"><div id="pane-side"><div role="row" id="chat-row">
    <img />
    <div class="content">
      <div><span data-testid="cell-frame-title">Palafox</span></div>
      <div><span data-testid="cell-frame-secondary">最近消息</span></div>
    </div>
  </div></div></div>`;

describe('chat tag renderer real-identity regressions', () => {
  let renderer: ChatTagRenderer;
  let tagMap: ConversationTagMap;
  let noteMap: ConversationNoteMap;
  const host = () => document.querySelector<HTMLElement>(hostSelector);
  const title = () => document.querySelector<HTMLElement>('[data-testid="cell-frame-title"]')!;
  const labels = () => host()?.shadowRoot?.querySelector('.labels')?.textContent;
  const settle = () => new Promise((resolve) => window.setTimeout(resolve, 180));

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = fixture;
    tagMap = { [firstId]: ['follow-up'], [secondId]: ['paid'] };
    noteMap = {
      [firstId]: { text: '等待回复', updatedAt: 1 },
      [secondId]: { text: '另一会话', updatedAt: 1 },
    };
    mocks.getTagDefinitions.mockResolvedValue([
      { id: 'follow-up', name: '待跟进', color: '#0ea5e9' },
      { id: 'paid', name: '已付款', color: '#10b981' },
    ]);
    mocks.getConversationTags.mockResolvedValue(tagMap);
    mocks.getConversationNotes.mockResolvedValue(noteMap);
    mocks.getConversationSopStages.mockResolvedValue({});
    mocks.getCooperationProfiles.mockResolvedValue({});
    renderer = new ChatTagRenderer();
  });

  afterEach(() => renderer.stop());

  async function start() {
    renderer.start();
    await waitFor(() => expect(labels()).toContain('等待回复'));
  }

  it('restores a host removed by WhatsApp without reloading storage', async () => {
    await start();
    const original = host()!;
    original.remove();
    await waitFor(() => expect(labels()).toContain('等待回复'));
    expect(host()).not.toBe(original);
    expect(mocks.getConversationTags).toHaveBeenCalledTimes(1);
  });

  it('rematches when a virtual row changes only its title attribute', async () => {
    await start();
    title().setAttribute('title', '+52 729 687 3339');
    await waitFor(() => expect(host()?.dataset.conversationId).toBe(secondId));
    expect(labels()).toContain('另一会话');
    expect(labels()).not.toContain('等待回复');
    expect(mocks.getConversationTags).toHaveBeenCalledTimes(1);
  });

  it('rematches when React updates an existing title text node', async () => {
    await start();
    (title().firstChild as Text).data = '+52 729 687 3339';
    await waitFor(() => expect(labels()).toContain('另一会话'));
    expect(host()?.dataset.conversationId).toBe(secondId);
  });

  it('keeps the existing identity and labels after an avatar URL arrives asynchronously', async () => {
    await start();
    const original = host();
    document.querySelector('img')!.src = 'https://example.com/avatar.jpg?token=changed';
    await settle();
    expect(labels()).toContain('等待回复');
    expect(host()).toBe(original);
    expect(identityFromChatRow(document.querySelector('#chat-row')!)?.id).toBe(firstId);
  });

  it('recovers after WhatsApp replaces the app/list root', async () => {
    await start();
    document.querySelector('#app')!.outerHTML = fixture;
    await waitFor(() => expect(labels()).toContain('等待回复'));
    expect(mocks.getConversationTags).toHaveBeenCalledTimes(1);
  });

  it('updates equal-length notes and renamed tags on a storage notification', async () => {
    await start();
    mocks.getConversationNotes.mockResolvedValue({
      ...noteMap, [firstId]: { text: '已经回复', updatedAt: 1 },
    });
    mocks.getTagDefinitions.mockResolvedValue([
      { id: 'follow-up', name: '待核对', color: '#ff0000' },
    ]);
    const listener = mocks.onChanged.addListener.mock.calls[0]![0];
    listener({ conversationNotes: {}, tagDefinitions: {} }, 'local');
    await waitFor(() => expect(labels()).toContain('已经回复'));
    expect(labels()).toContain('待核对');
    expect(host()?.shadowRoot?.querySelector<HTMLElement>('.pill')?.style.getPropertyValue('--tag')).toBe('#ff0000');
  });

  it('keeps existing DOM and storage cache on selection, hover and preview changes', async () => {
    await start();
    const original = host();
    document.querySelector('#chat-row')!.setAttribute('aria-selected', 'true');
    document.querySelector('#chat-row')!.setAttribute('class', 'hovered');
    document.querySelector('[data-testid="cell-frame-secondary"]')!.textContent = '更新的最近消息';
    await settle();
    expect(host()).toBe(original);
    expect(mocks.getConversationTags).toHaveBeenCalledTimes(1);
    expect(mocks.getConversationNotes).toHaveBeenCalledTimes(1);
  });

  it('keeps another visible conversation unchanged when one row is recycled', async () => {
    await start();
    const secondRow = document.querySelector<HTMLElement>('#chat-row')!.cloneNode(true) as HTMLElement;
    secondRow.id = 'second-row';
    secondRow.querySelector(hostSelector)?.remove();
    secondRow.querySelector('[data-testid="cell-frame-title"]')!.textContent = '+52 729 687 3339';
    document.querySelector('#pane-side')!.append(secondRow);
    await waitFor(() => expect(secondRow.querySelector<HTMLElement>(hostSelector)?.dataset.conversationId).toBe(secondId));
    const secondHost = secondRow.querySelector<HTMLElement>(hostSelector)!;
    expect(secondHost.shadowRoot?.querySelector('.labels')).toHaveTextContent('另一会话');

    title().textContent = 'No saved data';
    await waitFor(() => expect(document.querySelector('#chat-row')!.querySelector(hostSelector)).toBeNull());
    expect(secondRow.querySelector(hostSelector)).toBe(secondHost);
    expect(secondHost.shadowRoot?.querySelector('.labels')).not.toHaveTextContent('等待回复');
    expect(mocks.getConversationTags).toHaveBeenCalledTimes(1);
  });

  it('clears stale labels while the title is missing and restores them when the marker returns', async () => {
    await start();
    const titleNode = title();
    titleNode.removeAttribute('data-testid');
    await waitFor(() => expect(host()).toBeNull());
    titleNode.setAttribute('data-testid', 'cell-frame-title');
    await waitFor(() => expect(labels()).toContain('等待回复'));
    expect(mocks.getConversationTags).toHaveBeenCalledTimes(1);
  });

  it('does not starve a repair while other list mutations keep arriving', async () => {
    await start();
    host()!.remove();
    const activity = document.createElement('span');
    document.querySelector('#chat-row')!.append(activity);
    let restoredDuringUpdates = false;
    for (let index = 0; index < 10; index += 1) {
      activity.textContent = String(index);
      await new Promise((resolve) => window.setTimeout(resolve, 30));
      restoredDuringUpdates ||= Boolean(host());
    }
    expect(restoredDuringUpdates).toBe(true);
    expect(labels()).toContain('等待回复');
    expect(mocks.getConversationTags).toHaveBeenCalledTimes(1);
  });

  it('uses the cache for the confirmed-switch safety pass without replacing unchanged hosts', async () => {
    await start();
    const original = host();
    renderer.reconcileVisibleRows();
    renderer.reconcileVisibleRows();
    await settle();
    expect(host()).toBe(original);
    expect(mocks.getConversationTags).toHaveBeenCalledTimes(1);
  });

  it('does not reinsert hosts after stop while the initial data is loading', async () => {
    let resolveTags!: (value: ConversationTagMap) => void;
    mocks.getConversationTags.mockReturnValue(new Promise((resolve) => { resolveTags = resolve; }));
    renderer.start();
    renderer.stop();
    resolveTags(tagMap);
    await settle();
    expect(host()).toBeNull();
  });
});

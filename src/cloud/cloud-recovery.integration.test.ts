import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({} as Record<string, any>));
const events = vi.hoisted(() => ({ addMessageListener: vi.fn() }));
vi.mock('wxt/browser', () => ({ browser: {
  storage: { local: {
    get: vi.fn(async (keys: string | string[]) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, structuredClone(state[key])]))),
    set: vi.fn(async (values: Record<string, unknown>) => Object.assign(state, structuredClone(values))),
  }, onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
  runtime: { getManifest: () => ({ version: '0.5.8' }), onMessage: { addListener: events.addMessageListener }, onInstalled: { addListener: vi.fn() } },
  alarms: { create: vi.fn(), clear: vi.fn(), onAlarm: { addListener: vi.fn() } },
} }));

import { CloudSyncManager } from './cloud-sync-manager';
import { cloudSyncStorageRoute } from './storage-change-routing';
import { listConversations, listAllMessages, openMessageDatabase, importCloudConversations, importCloudMessages, upsertMessages } from '../storage/message-db';
import { identityFromConversationData, identityFromChatRow, setIdentityUsername, setConversationMatchIndex } from '../whatsapp/conversation-identity';
import { ChatTagRenderer } from '../content/chat-tag-renderer';
import { getConversationNotes, getConversationTags, saveCloudSettings, saveConversationNote, toggleConversationTag } from '../storage/settings';
import { CLOUD_RECOVERY, CLOUD_CONFLICTS } from './cloud-recovery';
import { CLOUD_SYNC_CURSOR_KEY } from './config';
import { migrateLocalConversationIdentities } from './cloud-identity-migration';
import { setAutoReport } from './report-policy';
const liveFetch = globalThis.fetch.bind(globalThis);

const remote = {
  id: 'old-cloud-id', title: '+52 7296873339', avatarKey: null, revision: 10,
  tagIds: ['paid'], note: { text: '云端备注\n第二行', updatedAt: 10 }, profile: null, sopStage: null, sopStageHistory: [],
  createdAt: 1, updatedAt: 2, lastCapturedAt: 2, messageCount: 1, firstMessageAt: 1, lastMessageAt: 1,
  oldestMessageId: 'm1', newestMessageId: 'm1', historyStart: null,
};
const id = identityFromConversationData(remote, 'king')!.id;
const message = { key: 'old-cloud-id:m1', id: 'm1', conversationId: remote.id, direction: 'incoming', kind: 'text',
  text: 'Hola', quotedText: null, sender: null, timestampRaw: null, timestampMs: 1, capturedAt: 2, domOrder: 0, urls: [], mediaCount: 0 };
const response = (records: unknown[], extra: Record<string, unknown> = {}) => new Response(JSON.stringify({ code: 200, data: {
  schemaVersion: 9, username: 'king', whatsappAccountKey: '521111111111', serverTime: Date.now(), records,
  tagDefinitions: [{ id: 'paid', name: '已付款', color: '#123456' }], nextCursor: null, ...extra,
} }), { status: 200, headers: { 'Content-Type': 'application/json' } });

describe('end-to-end local cloud recovery', () => {
  beforeEach(async () => {
    setConversationMatchIndex(null);
    Object.keys(state).forEach(key => delete state[key]);
    // Existing recovery cases use a previously reported contact with auto sync enabled.
    state.cloudReportPolicy = { autoSync: true, reported: { [id]: 1 }, requests: {} };
    const db = await openMessageDatabase();
    const tx = db.transaction(['messages', 'conversations'], 'readwrite');
    tx.objectStore('messages').clear(); tx.objectStore('conversations').clear();
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    state.cloudSettings = { username: 'king', whatsappAccount: '+521111111111' };
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      const payload = JSON.parse(String(init.body));
      if (url.endsWith('/download')) return response(payload.resource === 'conversations' ? [remote] : [message]);
      return new Response(JSON.stringify({ code: 200, data: { revision: 20, conversationId: remote.id } }));
    }));
  });

  it('defaults to manual reporting and discards legacy upload queues even after cloud recovery and edits', async () => {
    delete state.cloudReportPolicy;
    await importCloudConversations([{ ...remote, id }]);
    state.cloudSyncPendingConversations = [id];
    state.conversationNotes = { [id]: { text: '只保存在本机', updatedAt: 20 } };
    const manager = new CloudSyncManager(0);
    await manager.start();
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('success'));
    await manager.enqueueConversation(id);
    await manager.enqueueAll();
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('success'));
    expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).endsWith('/download'))).toBe(true);
    expect(state.cloudSyncPendingConversations).toEqual([]);
    expect(state.cloudReportPolicy?.reported[id]).toBeUndefined();
    expect(state.conversationNotes[id].text).toContain('只保存在本机');
  });

  it('reports only the clicked conversation and requires another click for later edits', async () => {
    delete state.cloudReportPolicy;
    const other = { ...remote, title: '+1 202 555 8888' };
    const otherId = identityFromConversationData(other, 'king')!.id;
    await importCloudConversations([{ ...remote, id }, { ...other, id: otherId }]);
    state.conversationNotes = { [id]: { text: '选中上报', updatedAt: 20 }, [otherId]: { text: '不上传', updatedAt: 20 } };
    const manager = new CloudSyncManager(0);
    await manager.reportConversation(id);
    await vi.waitFor(() => expect(state.cloudReportPolicy.reported[id]).toBeGreaterThan(0));
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('success'));
    const uploads = () => vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/upload')).map(([, init]) => JSON.parse(String(init?.body)));
    expect(uploads()).toHaveLength(1);
    expect(uploads()[0].conversation.id).toBe(id);
    expect(state.cloudReportPolicy.requests).toEqual({});
    state.conversationNotes[id] = { text: '修改后等下次点击', updatedAt: 50 };
    await manager.enqueueConversation(id);
    await manager.enqueueConversation(otherId);
    await manager.retry();
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('success'));
    expect(uploads()).toHaveLength(1);
    const savedNote = uploads()[0].conversation.note;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      const body = JSON.parse(String(init?.body));
      if (String(url).endsWith('/download')) return response(body.resource === 'conversations' ? [{ ...remote, note: savedNote, revision: 20 }] : []);
      return new Response(JSON.stringify({ code: 200, data: { revision: 30, conversationId: remote.id } }));
    });
    await manager.reportConversation(id);
    await vi.waitFor(() => expect(uploads()).toHaveLength(2));
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('success'));
    expect(uploads()[1].conversation.note.text).toBe('修改后等下次点击');
    expect(uploads().every(body => body.conversation.id === id)).toBe(true);
  });

  it('auto sync only admits successfully reported contacts and switching it off blocks subsequent edits', async () => {
    delete state.cloudReportPolicy;
    await importCloudConversations([{ ...remote, id }]);
    const manager = new CloudSyncManager(0);
    await manager.reportConversation(id);
    await vi.waitFor(() => expect(state.cloudReportPolicy.reported[id]).toBeGreaterThan(0));
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('success'));
    await setAutoReport(true);
    const other = { ...remote, title: '+1 202 555 8888' };
    const otherId = identityFromConversationData(other, 'king')!.id;
    await importCloudConversations([{ ...other, id: otherId }]);
    state.conversationNotes[id] = { text: '自动更新', updatedAt: 30 };
    state.conversationNotes[otherId] = { text: '尚未手动上报', updatedAt: 30 };
    vi.mocked(fetch).mockClear();
    await manager.enqueueAll(false);
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('success'));
    const uploads = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/upload'));
    expect(uploads).toHaveLength(1);
    expect(JSON.parse(String(uploads[0]![1]?.body)).conversation.id).toBe(id);
    await setAutoReport(false);
    state.conversationNotes[id] = { text: '关闭后只保留本地', updatedAt: 40 };
    vi.mocked(fetch).mockClear();
    await manager.enqueueConversation(id);
    await manager.enqueueAll(false);
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('success'));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('retains a failed manual request over worker restart without authorizing other conversations', async () => {
    delete state.cloudReportPolicy;
    await importCloudConversations([{ ...remote, id }]);
    state.conversationNotes = { [id]: { text: '待上报修改', updatedAt: 20 } };
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url).endsWith('/upload')) throw new Error('offline');
      return original(url, init);
    });
    await new CloudSyncManager(0).reportConversation(id);
    await vi.waitFor(() => expect(state.cloudSyncState?.error).toBe('offline'));
    expect(state.cloudReportPolicy.requests[id]).toBeTruthy();
    expect(state.cloudReportPolicy.reported[id]).toBeUndefined();
    vi.mocked(fetch).mockImplementation(original);
    await new CloudSyncManager(0).start();
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('success'));
    expect(state.cloudReportPolicy.requests[id]).toBeUndefined();
    expect(state.cloudReportPolicy.reported[id]).toBeGreaterThan(0);
    expect(state.cloudReportPolicy.autoSync).toBe(false);
  });

  it('matches downloaded tags and profiles to a chat whose phone prefix is different', async () => {
    const contact = { ...remote, profile: { contactWhatsapp: remote.title, finalPrice: '400', platformAccount: 'player', updatedAt: 10 } };
    vi.mocked(fetch).mockImplementation(async (_url, init) => response(JSON.parse(String(init?.body)).resource === 'conversations' ? [contact] : [message]));
    await new CloudSyncManager(0).enqueueAll();
    await vi.waitFor(() => expect(state.cloudSyncState).toMatchObject({ status: 'success', error: null }));
    setIdentityUsername('king');
    setConversationMatchIndex(state.conversationMatchIndex);
    document.body.innerHTML = '<div id="pane-side"><div role="row"><div><div><span data-testid="cell-frame-title">+52 1 729 687 3339</span></div><div><span data-testid="cell-frame-secondary">Hola</span></div></div></div></div>';
    const row = document.querySelector('[role="row"]')!;
    const identity = identityFromChatRow(row)!;
    expect(identity.id).toBe(id);
    expect(state.conversationNotes[identity.id]).toEqual(remote.note);
    expect(state.cooperationProfiles[identity.id]).toMatchObject({ platformAccount: 'player', finalPrice: '400' });
    await new ChatTagRenderer().refresh();
    expect(row.querySelector('[data-kkfans-tag-host]')?.shadowRoot?.textContent).toContain('已付款');
    expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).endsWith('/download'))).toBe(true);
    setIdentityUsername(''); setConversationMatchIndex(null); document.body.innerHTML = '';
  });

  it('restores a unique cloud contact into an existing prefix-variant local record without rekeying or re-uploading history', async () => {
    const source = { ...remote, title: '+52 1 729 687 3339' };
    const localId = identityFromConversationData(source, 'king')!.id;
    await importCloudConversations([{ ...source, id: localId }]);
    await upsertMessages({ ...source, id: localId }, [{ ...message, direction: 'incoming', kind: 'text', conversationId: localId, key: `${localId}:m1` }]);
    await new CloudSyncManager(0).enqueueAll();
    await vi.waitFor(() => expect(state.cloudSyncState).toMatchObject({ status: 'success', error: null }));
    expect((await listConversations()).map(record => record.id)).toEqual([localId]);
    expect(await listAllMessages(localId)).toHaveLength(1);
    expect((await listAllMessages(localId))[0]?.cloudSynced).toBe(true);
    expect(state.conversationTags[localId]).toEqual(['paid']);
    expect(state.cloudMetadataBaselines[localId].serverId).toBe(remote.id);
    expect(state.cloudMetadataBaselines[localId].messageCount).toBe(remote.messageCount);
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/upload')).map(([, init]) => JSON.parse(String(init?.body)))).toEqual([]);
  });

  it('restores two different full numbers from one page when their last five digits collide', async () => {
    const other = { ...remote, id: 'another-cloud-id', title: '+1 202 997 3339', note: { text: '另一个人', updatedAt: 20 } };
    const otherId = identityFromConversationData(other, 'king')!.id;
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      return response(body.resource === 'conversations' ? [remote, other] : []);
    });
    await new CloudSyncManager(0).enqueueAll();
    await vi.waitFor(() => expect(state.cloudSyncState).toMatchObject({ status: 'success', error: null }));
    expect((await listConversations()).map(record => record.id).sort()).toEqual([id, otherId].sort());
    expect(state.conversationNotes[id]).toEqual(remote.note);
    expect(state.conversationNotes[otherId]).toEqual(other.note);
    expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).endsWith('/download'))).toBe(true);
  });

  it('restores colliding last-five contacts across metadata pages without merging them', async () => {
    const other = { ...remote, id: 'another-cloud-id', title: '+1 202 997 3339', note: { text: '另一个人', updatedAt: 20 } };
    const otherId = identityFromConversationData(other, 'king')!.id;
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.resource === 'messages') return response([]);
      return body.after ? response([other]) : response([remote], { nextCursor: remote.id });
    });
    await new CloudSyncManager(0).enqueueAll();
    await vi.waitFor(() => expect(state.cloudSyncState).toMatchObject({ status: 'success', error: null }));
    expect(state.conversationNotes[id]).toEqual(remote.note);
    expect(state.conversationNotes[otherId]).toEqual(other.note);
    expect(state.cloudMetadataBaselines[id].serverId).toBe(remote.id);
    expect(state.cloudMetadataBaselines[otherId].serverId).toBe(other.id);
    expect(state[CLOUD_RECOVERY].aliases['another-cloud-id']).toBe(otherId);
    expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).endsWith('/download'))).toBe(true);
  });

  // Opt-in read-only production diagnostic. All local writes use the in-memory
  // storage/IndexedDB above; uploads are explicitly blocked by the fetch guard.
  it.skipIf(!process.env.KKFANS_VERIFY_CLOUD)('verifies real cloud metadata can be restored and matched without any upload', async () => {
    state.cloudSettings = { username: 'kkflow01', whatsappAccount: '+528116893996' };
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (new URL(String(url)).pathname !== '/whatsapp/sync/download' || init?.method !== 'POST') {
        throw new Error('Read-only verification blocked a non-download request');
      }
      return liveFetch('https://kkfans.lllin.fun/whatsapp/sync/download', init);
    });
    await new CloudSyncManager(1100).enqueueAll();
    await vi.waitFor(() => expect(['success', 'error']).toContain(state.cloudSyncState?.status), { timeout: 55000 });
    expect(state.cloudSyncState?.error).toBeNull();
    expect(state.cloudSyncState?.status).toBe('success');
    const localId = identityFromConversationData({ title: '+52 1 33 3787 3673', avatarKey: null }, 'kkflow01')!.id;
    expect(state.conversationTags[localId]).toEqual(expect.arrayContaining(['video-published', 'paid', 'key-creator']));
    expect(Object.keys(state.conversationNotes).length).toBeGreaterThan(0);
    expect(Object.keys(state.cooperationProfiles).length).toBeGreaterThan(0);
    console.info('Read-only cloud verification:', {
      conversations: (await listConversations()).length,
      tagged: Object.values(state.conversationTags as Record<string, string[]>).filter(tags => tags.length).length,
      notes: Object.keys(state.conversationNotes).length,
      profiles: Object.keys(state.cooperationProfiles).length,
      messages: state.cloudSyncState.restoredMessages,
      uploads: vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/upload')).length,
    });
  }, 60000);

  it('restores a fresh installation and displays saved tags without uploading downloaded data', async () => {
    const manager = new CloudSyncManager(0);
    await manager.enqueueAll();
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('success'));
    expect(await getConversationTags()).toMatchObject({ [id]: ['paid'] });
    expect(await getConversationNotes()).toMatchObject({ [id]: { text: '云端备注\n第二行' } });
    expect((await listConversations())[0]).toMatchObject({ id, createdAt: 1, updatedAt: 2 });
    expect(await listAllMessages(id)).toHaveLength(1);
    expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).endsWith('/download'))).toBe(true);
    expect(state.cloudSyncState.restoredMessages).toBe(1);
    expect(cloudSyncStorageRoute({ cloudRestoreApplied: { newValue: 'token' }, conversationTags: { newValue: state.conversationTags } })).toEqual({ syncAll: false, conversationIds: [] });
  });

  it('the local-only background rejects legacy sync messages without network requests', async () => {
    state[CLOUD_RECOVERY] = { schemaVersion: 9, since: 10000, lastPullAt: Date.now(), aliases: {} };
    vi.stubGlobal('defineBackground', (main: () => void) => ({ main }));
    const { default: entry } = await import('../entrypoints/background');
    entry.main();
    expect(fetch).not.toHaveBeenCalled();
    const listener = events.addMessageListener.mock.calls.at(-1)![0];
    const sendResponse = vi.fn();
    expect(listener({ type: 'cloud:sync-all' }, {}, sendResponse)).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ ok: false, error: '当前版本仅本地保存，已停用云端同步与上报' }));
    expect(fetch).not.toHaveBeenCalled();
    expect(state[CLOUD_RECOVERY].since).toBe(10000);
  });

  it('manual sync reconciles all cloud metadata despite a recent incremental checkpoint', async () => {
    state[CLOUD_RECOVERY] = { schemaVersion: 9, since: 10000, lastPullAt: Date.now(), aliases: {} };
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      return response(body.resource === 'conversations' && body.since === 0 ? [remote] : []);
    });
    await new CloudSyncManager(0).enqueueAll();
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('success'));
    expect(state.conversationTags[id]).toEqual(['paid']);
    expect(state.conversationNotes[id]?.text).toBe(remote.note.text);
    const requests = vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(requests.map(body => [body.resource, body.since])).toEqual([['conversations', 0], ['messages', 10000]]);
    expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).endsWith('/download'))).toBe(true);
    expect(state.cloudSyncState.lastDownloadedAt).toEqual(expect.any(Number));
  });

  it('a persisted manual restore request is honored after worker restart with no pending uploads', async () => {
    state[CLOUD_RECOVERY] = { schemaVersion: 9, since: 10000, lastPullAt: Date.now(), aliases: {} };
    state.cloudPullRequest = 'manual-request-before-worker-stopped';
    await new CloudSyncManager(0).start();
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('success'));
    expect(state.conversationTags?.[id]).toEqual(['paid']);
    expect(state.cloudPullRequest).toBeNull();
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)).since).toBe(0);
  });

  it('restores tags, note and cooperation profile under the same operator/phone ID used by chat rows', async () => {
    const username = 'kkflow01';
    const whatsappAccount = '+528116893996';
    state.cloudSettings = { username, whatsappAccount };
    const contact = { ...remote, title: '+52 1 33 3787 3673', avatarKey: 'https://example.com/old-avatar.jpg',
      tagIds: ['video-published', 'paid', 'key-creator'],
      profile: { contactWhatsapp: '+52 1 33 3787 3673', platformAccount: 'test-platform',
        instagramProfileUrl: 'https://www.instagram.com/test_creator/', followerData: '4,240 posts\n21.8K followers', finalPrice: '400', updatedAt: 10 } };
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      expect(String(url)).toMatch(/\/download$/);
      const body = JSON.parse(String(init?.body));
      return response(body.resource === 'conversations' ? [contact] : [], { username, whatsappAccountKey: '528116893996' });
    });
    await new CloudSyncManager(0).enqueueAll();
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('success'));
    setIdentityUsername(username);
    try {
      document.body.innerHTML = '<div id="pane-side"><div role="row"><img src="https://example.com/new-avatar.jpg" /><div><div><span data-testid="cell-frame-title">+5213337873673</span></div><div><span data-testid="cell-frame-secondary">最近消息</span></div></div></div></div>';
      const row = document.querySelector('[role="row"]')!;
      const localId = identityFromChatRow(row)!.id;
      await new ChatTagRenderer().refresh();
      expect(state.conversationTags[localId]).toEqual(contact.tagIds);
      expect(state.conversationNotes[localId]).toEqual(remote.note);
      expect(state.cooperationProfiles[localId]).toMatchObject({ platformAccount: 'test-platform', finalPrice: '400', followerData: '4,240 posts\n21.8K followers' });
      const host = row.querySelector<HTMLElement>('[data-kkfans-tag-host]');
      expect(host?.dataset.conversationId).toBe(localId);
      expect(host?.shadowRoot?.textContent).toContain('视频已发布');
      expect(host?.shadowRoot?.textContent).toContain('已付款');
      expect(host?.shadowRoot?.textContent).toContain('重点博主');
      expect(host?.shadowRoot?.textContent).toContain('云端备注');
      expect(state.conversationTags[contact.id]).toBeUndefined();
    } finally { setIdentityUsername(''); document.body.innerHTML = ''; }
  });

  it('resumes full metadata pages after a failure and retains the incremental message watermark', async () => {
    state[CLOUD_RECOVERY] = { schemaVersion: 9, since: 10000, lastPullAt: Date.now(), aliases: {} };
    vi.mocked(fetch).mockImplementationOnce(async () => response([remote], { nextCursor: remote.id }))
      .mockRejectedValueOnce(new Error('offline'));
    await new CloudSyncManager(0).enqueueAll();
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('error'));
    expect(state.cloudPullRequest).toEqual(expect.any(String));
    expect(state[CLOUD_RECOVERY].resume).toMatchObject({ fullMetadata: true, after: remote.id, since: 10000 });
    vi.mocked(fetch).mockClear().mockImplementation(async () => response([]));
    await new CloudSyncManager(0).start();
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('success'));
    const bodies = vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(bodies.map(body => [body.resource, body.since, body.after])).toEqual([
      ['conversations', 0, remote.id], ['messages', 10000, undefined],
    ]);
    expect(state.conversationNotes[id]).toEqual(remote.note);
    expect(state.cloudPullRequest).toBeNull();
  });

  it('migrates legacy IDs, metadata and uploaded progress without re-uploading history', async () => {
    await importCloudConversations([remote]);
    await upsertMessages(remote, [{ ...message, direction: 'incoming', kind: 'text' }]);
    // A completed older migration must not suppress duplicates introduced later.
    state.cloudIdentityMigrationVersion = '["king","521111111111"]:v2';
    state.conversationTags = { [remote.id]: remote.tagIds };
    state.conversationNotes = { [remote.id]: remote.note };
    state[CLOUD_SYNC_CURSOR_KEY] = { [JSON.stringify(['king', '+521111111111', remote.id])]: { capturedAt: 2, keys: [message.key] } };
    await new CloudSyncManager(0).enqueueAll();
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('success'));
    expect((await listConversations()).map(c => c.id)).toEqual([id]);
    expect(state.conversationNotes[id].text).toBe(remote.note.text);
    expect(state.conversationNotes[remote.id]).toBeUndefined();
    expect((await listAllMessages(id))[0]?.cloudSynced).toBe(true);
    expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).endsWith('/download'))).toBe(true);
  });

  it('recovers metadata migration if a worker stopped after the message IDs were moved', async () => {
    const identity = identityFromConversationData(remote, 'king')!;
    await importCloudConversations([{ ...remote, id: identity.id }]);
    state.conversationTags = { [remote.id]: ['paid'] };
    state.conversationNotes = { [remote.id]: remote.note };
    state.cloudIdentityMigrationPending = { identity, aliasIds: [remote.id] };
    await migrateLocalConversationIdentities(state.cloudSettings);
    expect(state.conversationNotes[id].text).toBe(remote.note.text);
    expect(state.conversationTags[id]).toEqual(['paid']);
    expect(state.cloudIdentityMigrationPending).toBeNull();
  });

  it('merges a restored Mexico +52 1 legacy alias into the current +52 chat and carries its cloud revision', async () => {
    const current = {
      ...remote,
      id: identityFromConversationData({ title: '52 722 634 7609', avatarKey: null }, 'king')!.id,
      title: '52 722 634 7609',
    };
    const legacy = {
      ...remote,
      id: 'chat_0ru0u3b',
      title: '+52 1 722 634 7609',
    };
    await importCloudConversations([current, legacy]);
    state.cloudMetadataBaselines = {
      [legacy.id]: {
        revision: 1788465134057,
        serverId: legacy.id,
        value: { tagIds: legacy.tagIds, note: legacy.note, profile: null, sopStage: null },
        messageCount: 29,
      },
    };
    state[CLOUD_RECOVERY] = {
      schemaVersion: 9,
      since: 10000,
      lastPullAt: Date.now(),
      aliases: { [legacy.id]: legacy.id },
    };

    await migrateLocalConversationIdentities(state.cloudSettings);

    expect((await listConversations()).map(record => record.id)).toEqual([current.id]);
    expect(state.cloudMetadataBaselines[current.id]).toMatchObject({
      revision: 1788465134057,
      serverId: legacy.id,
      messageCount: 29,
    });
    expect(state.cloudMetadataBaselines[legacy.id]).toBeUndefined();
    expect(state[CLOUD_RECOVERY].aliases[legacy.id]).toBe(current.id);
  });

  it('does not upload if the cloud endpoint is missing, even when local edits are queued', async () => {
    state.cloudReportPolicy.reported['local-pending'] = 1;
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 404 }));
    const manager = new CloudSyncManager(0);
    await manager.enqueueConversation('local-pending');
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('error'));
    expect(state.cloudSyncState.error).toContain('先更新服务端');
    expect(state.cloudSyncPendingConversations).toContain('local-pending');
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
  });

  it('retains a safely applied page and resumes after a download failure', async () => {
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementationOnce(original).mockRejectedValueOnce(new Error('offline'));
    const manager = new CloudSyncManager(0);
    await manager.enqueueAll();
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('error'));
    expect(state[CLOUD_RECOVERY].resume.resource).toBe('messages');
    expect(await getConversationNotes()).toHaveProperty(id);
    await manager.retry();
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('success'));
    expect(await listAllMessages(id)).toHaveLength(1);
    expect(state[CLOUD_RECOVERY].resume).toBeUndefined();
  });

  it('does not apply a response from the wrong namespace', async () => {
    vi.mocked(fetch).mockResolvedValue(response([remote], { username: 'another-user' }));
    const manager = new CloudSyncManager(0);
    await manager.enqueueAll();
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('error'));
    expect(await listConversations()).toEqual([]);
    expect(state.cloudSyncState.error).toContain('账号不匹配');
  });

  it('blocks upload against an older server even when that server supports downloading', async () => {
    vi.mocked(fetch).mockImplementation(async () => response([remote], { schemaVersion: 8 }));
    await new CloudSyncManager(0).enqueueAll();
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('error'));
    expect(state.cloudSyncState.error).toContain('防重复同步协议');
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
  });

  it('keeps a failed manual refresh mandatory after the background worker restarts', async () => {
    const manager = new CloudSyncManager(0);
    await manager.enqueueAll();
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('success'));
    state.conversationNotes[id] = { text: '本地未上传', updatedAt: 20 };
    vi.mocked(fetch).mockClear().mockRejectedValue(new Error('offline'));
    await manager.enqueueAll();
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('error'));
    expect(state[CLOUD_RECOVERY].resume?.resource).toBe('conversations');
    vi.mocked(fetch).mockClear();
    const restarted = new CloudSyncManager(0);
    await restarted.enqueueConversation(id);
    await vi.waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBe(1));
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('error'));
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toMatch(/\/download$/);
    expect(state.conversationNotes[id].text).toBe('本地未上传');
  });

  it('blocks metadata edits during restoration without altering existing values', async () => {
    state.cloudSyncState = { status: 'restoring' };
    state.conversationNotes = { [id]: { text: '原备注', updatedAt: 5 } };
    await expect(saveConversationNote(id, '冲突编辑')).rejects.toThrow('云端恢复中');
    await expect(toggleConversationTag(id, 'paid')).rejects.toThrow('云端恢复中');
    expect(state.conversationNotes[id].text).toBe('原备注');
    expect(state.conversationTags).toBeUndefined();
  });

  it('applies all pages serially and coalesces concurrent sync clicks', async () => {
    const older = { ...message, id: 'm0', key: 'old-cloud-id:m0', timestampMs: 0 };
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.resource === 'conversations') return response(body.after ? [] : [{ ...remote, messageCount: 2 }], { nextCursor: body.after ? null : remote.id, serverTime: 10000 });
      return response(body.after ? [message] : [older], { nextCursor: body.after ? null : older.key, serverTime: 20000 });
    });
    const manager = new CloudSyncManager(0);
    await Promise.all([manager.enqueueAll(), manager.enqueueAll(), manager.enqueueAll()]);
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('success'));
    expect((await listAllMessages(id)).map(m => m.id)).toEqual(['m0', 'm1']);
    expect(vi.mocked(fetch).mock.calls.map(([, init]) => {
      const body = JSON.parse(String(init?.body));
      return [body.resource, body.after];
    })).toEqual([['conversations', undefined], ['conversations', remote.id], ['messages', undefined], ['messages', older.key]]);
    expect(state[CLOUD_RECOVERY].since).toBe(9000);
  });

  it('stops repeated cursors instead of looping or uploading incomplete data', async () => {
    vi.mocked(fetch).mockImplementation(async () => response([remote], { nextCursor: remote.id }));
    await new CloudSyncManager(0).enqueueAll();
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('error'));
    expect(state.cloudSyncState.error).toContain('分页游标重复');
    expect(vi.mocked(fetch).mock.calls).toHaveLength(2);
    expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).endsWith('/download'))).toBe(true);
  });

  it('keeps the recovery checkpoint on 429 and observes Retry-After', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 429, headers: { 'Retry-After': '90' } }));
    await new CloudSyncManager(0).enqueueAll();
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('error'));
    expect(state.cloudSyncState.error).toContain('95 秒后自动重试');
    expect(state[CLOUD_RECOVERY].resume.resource).toBe('conversations');
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
  });

  it('binds the local data to its account and rejects switching it to another account', async () => {
    const manager = new CloudSyncManager(0);
    await manager.enqueueAll();
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('success'));
    await expect(saveCloudSettings({ username: 'other', whatsappAccount: '+521111111111' })).rejects.toThrow('独立浏览器环境');
    expect(state.cloudSettings.username).toBe('king');
  });

  it('only sends explicit changed fields with the downloaded version after restoration', async () => {
    const manager = new CloudSyncManager(0);
    await manager.enqueueAll();
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('success'));
    state.conversationTags[id] = [];
    await manager.enqueueConversation(id);
    await vi.waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/upload'))).toBe(true));
    const upload = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith('/upload'))!;
    expect(JSON.parse(String(upload[1]?.body))).toMatchObject({ schemaVersion: 9, metadataBaseVersion: 10, metadataFields: ['tagIds'],
      conversation: { tagIds: [] }, messages: [] });
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('success'));
  });

  it('retains both versions of conflicting edits and allows explicit resolution', async () => {
    const manager = new CloudSyncManager(0);
    await manager.enqueueAll();
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('success'));
    state.conversationNotes[id] = { text: '本地修改', updatedAt: 20 };
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url).endsWith('/upload')) return new Response(JSON.stringify({ code: 200, data: { revision: 40, conversationId: remote.id } }));
      const body = JSON.parse(String(init?.body));
      return response(body.resource === 'conversations' ? [{ ...remote, revision: 30, note: { text: '云端修改', updatedAt: 30 } }] : []);
    });
    await manager.enqueueAll();
    await vi.waitFor(() => expect(state.cloudSyncState?.conflictCount).toBe(1));
    expect(state.conversationNotes[id].text).toBe('本地修改');
    expect(state[CLOUD_CONFLICTS][id].remote.value.note.text).toBe('云端修改');
    await manager.resolveConflicts('cloud');
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('success'));
    expect(state.conversationNotes[id].text).toBe('云端修改');
  });

  it('fully rechecks metadata once after 409, preserving offline edits and incremental messages', async () => {
    const manager = new CloudSyncManager(0);
    await manager.enqueueAll();
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('success'));
    const since = state[CLOUD_RECOVERY].since;
    state.conversationNotes[id] = { text: '离线备注', updatedAt: 20 };
    const order: string[] = [];
    let uploads = 0;
    vi.mocked(fetch).mockClear().mockImplementation(async (url, init) => {
      const body = JSON.parse(String(init?.body));
      if (String(url).endsWith('/upload')) {
        order.push('upload');
        if (++uploads === 1) return new Response(JSON.stringify({ message: '云端资料已更新，请先同步恢复后重试' }), { status: 409 });
        expect(body.metadataBaseVersion).toBe(30);
        expect(body.metadataFields).toEqual(['note']);
        expect(body.conversation.note.text).toBe('离线备注');
        expect(body.conversation.tagIds).toEqual(['paid', 'interested']);
        return new Response(JSON.stringify({ code: 200, data: { revision: 40, conversationId: remote.id } }));
      }
      order.push(body.resource);
      expect(body.since).toBe(body.resource === 'conversations' ? 0 : since);
      return response(body.resource === 'conversations' ? [{ ...remote, revision: 30, tagIds: ['paid', 'interested'] }] : []);
    });
    await manager.enqueueConversation(id);
    await vi.waitFor(() => expect(uploads).toBe(2));
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('success'));
    expect(order).toEqual(['upload', 'conversations', 'messages', 'upload']);
    expect(state.conversationNotes[id].text).toBe('离线备注');
    expect(state.cloudVersionConflict).toBeNull();
  });

  it('stops persistent 409 retries across alarms and worker restarts without dropping pending data', async () => {
    const manager = new CloudSyncManager(0);
    await manager.enqueueAll();
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('success'));
    state.conversationNotes[id] = { text: '本地保留', updatedAt: 20 };
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockClear().mockImplementation(async (url, init) => String(url).endsWith('/upload')
      ? new Response(JSON.stringify({ message: '云端资料已更新，请先同步恢复后重试' }), { status: 409 }) : original(url, init));
    await manager.enqueueConversation(id);
    await vi.waitFor(() => expect(state.cloudVersionConflict?.attempts).toBe(2));
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('error'));
    expect(state.cloudSyncState.error).toContain(remote.title);
    expect(state.cloudSyncPendingConversations).toContain(id);
    const calls = vi.mocked(fetch).mock.calls.length;
    state.cloudSyncState.status = 'pending';
    await manager.retry();
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('error'));
    state.cloudSyncState.status = 'pending';
    await new CloudSyncManager(0).start();
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('error'));
    expect(fetch).toHaveBeenCalledTimes(calls);
    expect(state.conversationNotes[id].text).toBe('本地保留');
    // A deliberate user recovery unlocks the bounded retry after the server fix.
    vi.mocked(fetch).mockImplementation(original);
    await manager.enqueueAll();
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('success'));
    expect(state.cloudVersionConflict).toBeNull();
    expect(state.conversationNotes[id].text).toBe('本地保留');
  });

  it('skips cloud-deleted contacts without acknowledging local messages or blocking other contacts', async () => {
    const deleted = { ...remote, id: 'chat_v2_0534ce280c39a309', title: '+52 1 56 2620 2013' };
    const deletedId = identityFromConversationData(deleted, 'king')!.id;
    state.cloudReportPolicy.reported[deletedId] = 1;
    await importCloudConversations([{ ...deleted, id: deletedId }]);
    await upsertMessages({ ...deleted, id: deletedId }, [{ ...message, direction: 'incoming', kind: 'text',
      key: `${deletedId}:m1`, conversationId: deletedId }]);
    state.conversationNotes = { [deletedId]: { text: '保留本地内容', updatedAt: 20 } };
    const original = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => String(url).endsWith('/upload')
      ? new Response(JSON.stringify({ code: 200, data: { revision: 30, conversationId: 'legacy-deleted', skipped: 'deleted' } })) : original(url, init));
    const manager = new CloudSyncManager(0);
    await manager.enqueueAll();
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('success'));
    expect(state.cloudSyncState.skippedConversations).toBe(1);
    expect(state.conversationTags[id]).toEqual(['paid']);
    expect(state.conversationNotes[deletedId].text).toBe('保留本地内容');
    expect((await listAllMessages(deletedId))[0]?.cloudSynced).not.toBe(true);
    expect(await listAllMessages(deletedId)).toHaveLength(1);
    expect(state.cloudMetadataBaselines[deletedId]).toBeUndefined();
    vi.mocked(fetch).mockClear();
    let clearedBeforeRetry = false;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url).endsWith('/upload')) {
        clearedBeforeRetry = !state.cloudSkippedConversations?.[deletedId];
        return new Response(JSON.stringify({ code: 200, data: { revision: 31, conversationId: 'legacy-deleted', skipped: 'deleted' } }));
      }
      return original(url, init);
    });
    await manager.enqueueConversation(deletedId);
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('success'));
    expect(clearedBeforeRetry).toBe(true);
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/upload'))).toHaveLength(1);
    vi.mocked(fetch).mockClear();
    await new CloudSyncManager(0).enqueueConversation(deletedId);
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('success'));
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/upload'))).toHaveLength(1);
  });

  it('keeps an unchanged legacy deletion skipped on restart but manual recovery clears it', async () => {
    await importCloudConversations([remote]);
    state.cloudSkippedConversations = { [id]: { serverId: remote.id, revision: 5, title: remote.title, reason: 'deleted' } };
    state.cloudMetadataBaselines = {
      [id]: {
        revision: 4,
        serverId: remote.id,
        value: { tagIds: [], note: null, profile: null, sopStage: null },
        historyStart: null,
      },
    };
    state[CLOUD_RECOVERY] = { schemaVersion: 9, since: 10000, lastPullAt: Date.now(), aliases: {} };
    const manager = new CloudSyncManager(0);
    await manager.start();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(fetch).not.toHaveBeenCalled();
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      const body = JSON.parse(String(init?.body));
      if (String(url).endsWith('/download')) return response([]);
      return new Response(JSON.stringify({ code: 200, data: { revision: 30, conversationId: remote.id } }));
    });
    await manager.enqueueAll();
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('success'));
    expect(state.cloudSkippedConversations[id]).toBeUndefined();
    expect(state.cloudMetadataBaselines[id]).toMatchObject({ revision: 30, serverId: remote.id });
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/upload'))).toBe(true);
  });

  it('invalidates a stale baseline when an explicitly retried deleted contact otherwise looks clean', async () => {
    await importCloudConversations([{ ...remote, id }]);
    await importCloudMessages([{
      ...message,
      direction: 'incoming' as const,
      kind: 'text' as const,
      conversationId: id,
      key: `${id}:m1`,
    }]);
    const value = { tagIds: ['paid'], note: remote.note, profile: null, sopStage: null };
    state.conversationTags = { [id]: value.tagIds };
    state.conversationNotes = { [id]: value.note };
    state.cooperationProfiles = {};
    state.conversationSopStages = {};
    state.cloudMetadataBaselines = {
      [id]: { revision: 5, serverId: remote.id, value, historyStart: null },
    };
    state.cloudSkippedConversations = {
      [id]: { serverId: remote.id, revision: 6, title: remote.title, reason: 'deleted' },
    };
    state[CLOUD_SYNC_CURSOR_KEY] = {
      [JSON.stringify(['king', '+521111111111', id])]: {
        capturedAt: message.capturedAt,
        keys: [`${id}:m1`],
      },
    };
    state[CLOUD_RECOVERY] = { schemaVersion: 9, since: 10000, lastPullAt: Date.now(), aliases: {} };
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      expect(String(url)).toContain('/upload');
      const body = JSON.parse(String(init?.body));
      expect(body.metadataBaseVersion).toBe(0);
      expect(body.metadataFields).toEqual(['tagIds', 'note', 'profile', 'sopStage']);
      expect(body.messages).toEqual([expect.objectContaining({ id: 'm1', conversationId: id })]);
      return new Response(JSON.stringify({ code: 200, data: { revision: 30, conversationId: remote.id } }));
    });

    await new CloudSyncManager(0).enqueueConversation(id);
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('success'));

    expect(state.cloudSkippedConversations[id]).toBeUndefined();
    expect(state.cloudMetadataBaselines[id]).toMatchObject({ revision: 30, serverId: remote.id });
    expect(vi.mocked(fetch).mock.calls).toHaveLength(1);
  });

  it('persists a required full conflict recovery through a failed download and worker restart', async () => {
    const manager = new CloudSyncManager(0);
    await manager.enqueueAll();
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('success'));
    const since = state[CLOUD_RECOVERY].since;
    state.conversationNotes[id] = { text: '离线保留', updatedAt: 20 };
    vi.mocked(fetch).mockImplementation(async url => {
      if (String(url).endsWith('/upload')) return new Response(JSON.stringify({ message: 'version conflict' }), { status: 409 });
      throw new Error('download offline');
    });
    await manager.enqueueConversation(id);
    await vi.waitFor(() => expect(state.cloudSyncState?.error).toBe('download offline'));
    expect(state.cloudVersionConflict.attempts).toBe(1);
    expect(state.cloudPullRequest).toEqual(expect.any(String));
    expect(state[CLOUD_RECOVERY].resume).toMatchObject({ resource: 'conversations', fullMetadata: true, since });
    const order: string[] = [];
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      const body = JSON.parse(String(init?.body));
      if (String(url).endsWith('/upload')) {
        order.push('upload');
        expect(body.metadataBaseVersion).toBe(30);
        return new Response(JSON.stringify({ code: 200, data: { revision: 40, conversationId: remote.id } }));
      }
      order.push(body.resource);
      expect(body.since).toBe(body.resource === 'conversations' ? 0 : since);
      return response(body.resource === 'conversations' ? [{ ...remote, revision: 30 }] : []);
    });
    await new CloudSyncManager(0).start();
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('success'));
    expect(order).toEqual(['conversations', 'messages', 'upload']);
    expect(state.cloudVersionConflict).toBeNull();
    expect(state.conversationNotes[id].text).toBe('离线保留');
  });

  it('does not retry an overwrite when full conflict recovery finds both sides edited the same field', async () => {
    const manager = new CloudSyncManager(0);
    await manager.enqueueAll();
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('success'));
    state.conversationNotes[id] = { text: '本地修改', updatedAt: 20 };
    let uploads = 0;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url).endsWith('/upload')) {
        uploads++;
        return new Response(JSON.stringify({ message: 'version conflict' }), { status: 409 });
      }
      const body = JSON.parse(String(init?.body));
      return response(body.resource === 'conversations' ? [{ ...remote, revision: 30, note: { text: '云端修改', updatedAt: 30 } }] : []);
    });
    await manager.enqueueConversation(id);
    await vi.waitFor(() => expect(state.cloudSyncState?.conflictCount).toBe(1));
    expect(state.cloudSyncState.status).toBe('error');
    expect(uploads).toBe(1);
    expect(state.conversationNotes[id].text).toBe('本地修改');
    expect(state[CLOUD_CONFLICTS][id].remote.value.note.text).toBe('云端修改');
  });

  it('allows a previously skipped contact to resume if it is active in a later cloud download', async () => {
    state.cloudSkippedConversations = { [id]: { serverId: remote.id, revision: 5, title: remote.title, reason: 'deleted' } };
    const manager = new CloudSyncManager(0);
    await manager.enqueueAll();
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('success'));
    expect(state.cloudSkippedConversations[id]).toBeUndefined();
    expect(state.cloudSyncState.skippedConversations).toBe(0);
    state.conversationNotes[id] = { text: '恢复后更新', updatedAt: 20 };
    await manager.enqueueConversation(id);
    await vi.waitFor(() => expect(state.cloudSyncState?.status).toBe('success'));
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/upload'))).toHaveLength(1);
  });
});

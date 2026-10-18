// Offline verification of the actual production background.js, not TS imports.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';

const state = {
  cloudSettings: { username: 'bundle-test', whatsappAccount: '+521234567890' },
  cloudRecoveryState: { schemaVersion: 9, since: 10000, lastPullAt: Date.now(), aliases: {} },
};
const requests = [];
let deletedScenario = false;
let uploads = 0;
let listener;
const event = () => ({ addListener() {}, removeListener() {} });
const chrome = {
  runtime: { id: 'offline-bundle-test', getManifest: () => manifest,
    onMessage: { addListener(value) { listener = value; } }, onInstalled: event() },
  storage: { onChanged: event(), local: {
    async get(keys) { return Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, structuredClone(state[key])])); },
    async set(values) { Object.assign(state, structuredClone(values)); },
  } },
  alarms: { onAlarm: event(), async create() {}, async clear() {} },
};
const fetch = async (url, init) => {
  // This is a synthetic fetch implementation; it never calls the real network.
  assert.ok(['https://kkfans.lllin.fun/whatsapp/sync/download', 'https://kkfans.lllin.fun/whatsapp/sync/upload'].includes(url));
  const body = JSON.parse(init.body);
  if (url.endsWith('/upload')) {
    assert.ok(deletedScenario, 'Downloaded metadata must not be echoed back');
    uploads++;
    requests.push({ resource: 'upload', version: body.metadataBaseVersion });
    if (uploads === 1) return new Response(JSON.stringify({ message: 'version conflict' }), { status: 409 });
    assert.equal(uploads, 2, 'No unbounded conflict retry is allowed');
    return new Response(JSON.stringify({ code: 200, data: { revision: 30, conversationId: 'legacy-cloud-contact', skipped: 'deleted' } }));
  }
  requests.push({ resource: body.resource, since: body.since });
  const records = !deletedScenario && body.resource === 'conversations' ? [{
    id: 'legacy-cloud-contact', title: '+5215551234567', avatarKey: null,
    revision: 10, tagIds: ['paid'], note: { text: 'Restored note', updatedAt: 10 },
    profile: { finalPrice: '400', platformAccount: 'test-platform', updatedAt: 10 },
    sopStage: null, sopStageHistory: [], createdAt: 1, updatedAt: 2, lastCapturedAt: 2,
    messageCount: 0, oldestMessageId: null, newestMessageId: null, historyStart: null,
  }] : [];
  return new Response(JSON.stringify({ code: 200, data: {
    schemaVersion: 9, username: 'bundle-test', whatsappAccountKey: '521234567890',
    serverTime: Date.now(), records, tagDefinitions: [], nextCursor: null,
  } }));
};
async function until(predicate) {
  const end = Date.now() + 8000;
  while (!predicate()) {
    assert.ok(Date.now() < end, `Timed out: ${JSON.stringify(state.cloudSyncState)}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

const source = await readFile(new URL('../.output/chrome-mv3/background.js', import.meta.url), 'utf8');
const manifest = JSON.parse(await readFile(new URL('../.output/chrome-mv3/manifest.json', import.meta.url), 'utf8'));
runInNewContext(source, { chrome, indexedDB, IDBKeyRange, fetch, URL, TextEncoder, crypto,
  AbortSignal, setTimeout, clearTimeout, console }, { timeout: 2000 });
await until(() => state.cloudSyncState?.status === 'success');
assert.equal(requests.length, 0, 'Startup should reuse the recent checkpoint');
let response;
assert.equal(listener({ type: 'cloud:sync-all' }, {}, value => { response = value; }), true);
await until(() => response !== undefined);
assert.equal(response.ok, true);
await until(() => requests.length > 0 && ['success', 'error'].includes(state.cloudSyncState.status));
assert.equal(state.cloudSyncState.error, null);
assert.deepEqual(requests, [{ resource: 'conversations', since: 0 }, { resource: 'messages', since: 10000 }]);
assert.equal(Object.values(state.conversationTags).filter(tags => tags.includes('paid')).length, 1);
assert.equal(Object.values(state.conversationNotes)[0].text, 'Restored note');
assert.equal(Object.values(state.cooperationProfiles)[0].platformAccount, 'test-platform');
console.log('Production bundle verified: callback response, 2 downloads, restored tags/note/profile, 0 uploads. No network used.');

const localId = Object.keys(state.conversationTags)[0];
assert.equal(state.conversationMatchIndex.username, 'bundle-test');
assert.equal(state.conversationMatchIndex.conversations[0].id, localId);
let staleIdentityResponse;
assert.equal(listener({ type: 'db:resolve-conversation', conversation: { id: 'stale-before-download', title: '+525551234567', avatarKey: null } },
  {}, value => { staleIdentityResponse = value; }), true);
await until(() => staleIdentityResponse !== undefined);
assert.equal(staleIdentityResponse.ok, false, 'A stale DOM ID must not create another contact');
assert.match(staleIdentityResponse.error, /联系人匹配已更新/);
assert.equal(requests.length, 2, 'Identity lookup must not enqueue an upload');
state.conversationNotes[localId] = { text: 'Preserved offline edit', updatedAt: 20 };
const previousWatermark = state.cloudRecoveryState.since;
deletedScenario = true;
requests.length = 0;
let captureResponse;
assert.equal(listener({ type: 'db:upsert-messages', conversation: { id: localId, title: '+525551234567', avatarKey: null },
  messages: [{ key: `${localId}:m1`, id: 'm1', conversationId: localId, direction: 'incoming', kind: 'text', text: 'Offline message',
    quotedText: null, sender: null, timestampRaw: null, timestampMs: 100, capturedAt: 100, urls: [], mediaCount: 0, domOrder: 0 }] },
{}, value => { captureResponse = value; }), true);
await until(() => captureResponse !== undefined);
assert.equal(captureResponse.ok, true);
await until(() => uploads === 2 && state.cloudSyncState.status === 'success');
assert.deepEqual(requests, [
  { resource: 'upload', version: 10 }, { resource: 'conversations', since: 0 },
  { resource: 'messages', since: previousWatermark }, { resource: 'upload', version: 10 },
]);
assert.equal(state.cloudSyncState.skippedConversations, 1);
assert.equal(state.cloudSyncState.pendingCount, 0);
assert.equal(state.cloudVersionConflict, null);
assert.equal(state.cloudMetadataBaselines[localId].revision, 10, 'Skipped is not an acknowledgement');
assert.equal(state.conversationNotes[localId].text, 'Preserved offline edit');
console.log(`Production bundle ${manifest.version} verified: last-four match preserves contact ID, rejects stale IDs; 409 -> restore -> deleted skip preserves edits. No network used.`);

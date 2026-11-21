import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLibrary } from '../server/database.js';
import { createDatabaseConnector } from '../server/database-runtime.js';
import { seedApprovedBrowser } from '../test-support/pairing.js';
import { area, event } from '../test-support/chrome-mock.js';

test('browser organization edits round trip through SQLite; offline changes never persist or replay', async t => {
  const original = { chrome: globalThis.chrome, fetch: globalThis.fetch };
  const dir = await mkdtemp(join(tmpdir(), 'readflow-organization-'));
  const library = await openLibrary(dir, { initialize: true });
  t.after(async () => { Object.assign(globalThis, original); library.close(); await rm(dir, { recursive: true, force: true }); });
  const runtime = createDatabaseConnector({ library, store: library.store, exclusive: work => work() });
  const local = { connectionEndpoint: 'https://connection.example.com/', collectionIdentity: library.identity };
  globalThis.chrome = {
    permissions: { contains: async () => true }, storage: { local: area(local) },
    runtime: { id: 'test', getURL: path => `chrome-extension://test/${path}`, onInstalled: event(), onStartup: event(), onMessage: event() },
    alarms: { onAlarm: event() }, contextMenus: { onClicked: event() },
    action: { onClicked: event(), setTitle: async () => {}, setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
    tabs: { query: async () => [{ url: 'https://example.com/tool', title: 'Tool' }] },
  };
  await seedApprovedBrowser(chrome.storage.local, local.connectionEndpoint);
  local.connectionProvider = 'database';
  let offline = false, supported = true;
  globalThis.fetch = async (url, options) => {
    if (offline) throw new Error('offline');
    const result = await runtime.dispatch(new URL(url).pathname.slice(4), JSON.parse(options.body));
    if (!supported && result.capabilities) delete result.capabilities.organization;
    return Response.json(result);
  };
  await import('../src/service-worker.js');
  const send = (message, popup = false) => new Promise(resolve => chrome.runtime.onMessage.emit(message,
    { id: 'test', frameId: 0, url: chrome.runtime.getURL(popup ? 'src/popup.html' : 'src/options.html') }, resolve));
  const firstContext = await send({ type: 'CAPTURE_CONTEXT' }, true); assert.equal(firstContext.ok, true, JSON.stringify(firstContext)); assert.equal(firstContext.existing, false);
  assert.equal((await send({ type: 'CAPTURE_PAGE', metadata: { purpose: 'reference', contentType: 'tool', starred: true, remark: 'Use later', tags: ['work'] } }, true)).ok, true);
  const saved = local.items[0];
  assert.equal(saved.purpose, 'reference'); assert.equal(saved.starred, true);
  const context = await send({ type: 'CAPTURE_CONTEXT' }, true);
  assert.equal(context.existing, true); assert.equal(context.contentType, 'tool'); assert.equal(context.remark, 'Use later');
  const root = await send({ type: 'CREATE_FOLDER', name: 'Research', parentId: null });
  assert.equal(root.ok, true);
  const child = await send({ type: 'CREATE_FOLDER', name: 'Tools', parentId: root.folderId });
  assert.equal(child.ok, true);
  assert.equal((await send({ type: 'CREATE_FOLDER', name: 'Tools', parentId: root.folderId })).folderId, child.folderId);
  assert.equal(local.knowledgeSync.folders.length, 2);
  assert.equal((await send({ type: 'UPDATE_METADATA', id: saved.id, metadata: { folderId: child.folderId } })).ok, true);
  assert.equal(local.items[0].folderId, child.folderId);
  assert.match((await send({ type: 'EXPORT_CSV' })).csv, /Research \/ Tools/);
  assert.throws(() => library.createFolder('Invalid parent', 'folder_' + '0'.repeat(32)), /Parent folder/);
  await send({ type: 'SET_STATUS', id: saved.id, status: '已读' });
  const readAt = local.items[0].readAt;
  assert.equal((await send({ type: 'UPDATE_METADATA', id: saved.id, metadata: { purpose: 'later' } })).ok, true);
  assert.equal(local.items[0].folderId, null);
  assert.equal((await send({ type: 'UPDATE_METADATA', id: saved.id, metadata: { folderId: child.folderId } })).ok, false);
  await send({ type: 'SYNC' });
  assert.equal(local.knowledgeSync.folders[1].parentId, root.folderId);
  assert.equal(local.items[0].readAt, readAt); assert.equal(local.items[0].remark, 'Use later');
  const before = structuredClone(local.items);
  offline = true;
  assert.equal((await send({ type: 'UPDATE_METADATA', id: saved.id, metadata: { starred: false } })).ok, false);
  assert.deepEqual(local.items, before);
  assert.equal((await send({ type: 'CAPTURE_CONTEXT' }, true)).ok, false, 'offline context cannot pretend a page is new');
  offline = false; await send({ type: 'SYNC' });
  assert.equal(local.items[0].starred, true); assert.equal(library.list().length, 1);
  supported = false;
  assert.equal((await send({ type: 'UPDATE_METADATA', id: saved.id, metadata: { starred: false } })).ok, false);
  assert.equal(library.list()[0].starred, true, 'old services cannot silently discard organization edits');
});

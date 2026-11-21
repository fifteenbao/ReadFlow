import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, generateKeyPairSync, createHash, sign } from 'node:crypto';
import { openLibrary } from '../server/database.js';
import { createFileState } from '../server/file-state.js';
import { createHost } from '../server/host.js';
import { createDatabaseConnector } from '../server/database-runtime.js';
import { createFeishuService } from '../server/feishu-service.js';
import { libraryCsv } from '../server/lib/csv.js';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'readflow-db-'));
  const persistence = await createFileState({ stateDir: dir, authentication: 'paired' }); await persistence.initialize();
  const library = await openLibrary(dir, { initialize: true });
  t.after(async () => { try { library.close(); } catch {} await rm(dir, { recursive: true, force: true }); });
  return { dir, library, persistence };
}
const item = (extra = {}) => ({ id: randomUUID(), title: 'An article', url: 'https://example.com/article', savedAt: '2026-10-22T00:00:00Z', ...extra });

test('SQLite is the sole source: atomic capture, dedupe, edit replay, read state and restart persistence', async t => {
  const { dir, library } = await fixture(t);
  const capture = item({ metadataUpdate: { id: randomUUID(), fields: { tags: ['AI'], remark: 'First' } } });
  const result = library.sync([capture]); assert.equal(result.created, 1);
  const id = result.articles[0].recordId;
  library.setStatus(id, '已读');
  library.sync([item({ metadataUpdate: { id: randomUUID(), fields: { remark: 'Newer' } } })]);
  library.sync([capture]); // Lost response retry cannot overwrite newer edits.
  assert.equal(library.get(id).remark, 'Newer'); assert.equal(library.get(id).read, true);
  assert.equal(library.sync([item()]).created, 0);
  assert.throws(() => library.sync([item({ url: 'https://example.com/new' }), item({ url: 'javascript:bad' })]));
  assert.equal(library.list().length, 1);
  const another = await openLibrary(dir); assert.equal(another.get(id).remark, 'Newer'); assert.deepEqual(another.identity, library.identity); another.close();
  library.setStatus(id, '已读'); library.applyAction('event1', id, 'later', 1000); library.applyAction('event1', id, 'later', 5000);
  assert.equal(library.get(id).status, '待阅读'); assert.equal(library.get(id).read, false);
  assert.equal(Object.hasOwn(library.get(id), 'snoozedUntil'), false);
  library.applyAction('event2', id, 'skip'); assert.equal(library.get(id).status, '跳过'); assert.equal(library.get(id).read, true);
});

test('sync dedupes equivalent URLs after WHATWG normalization', async t => {
  const { library } = await fixture(t);
  assert.equal(library.sync([item({ url: 'https://EXAMPLE.com/path' })]).created, 1);
  assert.equal(library.sync([item({ id: randomUUID(), url: 'https://example.com:443/path' })]).created, 0);
  assert.equal(library.list().length, 1);
  assert.equal(library.list()[0].url, 'https://example.com/path');
});

test('database host needs no Feishu credentials; authenticated library identity cannot be replaced', async t => {
  const { dir } = await fixture(t);
  const host = await createHost({ stateDir: dir, baseUrl: 'https://connection.example.com/readflow/', extensionId: '', connector: { storageProvider: 'database' } }, { getCredentials: () => assert.fail('must not authorize Feishu') });
  t.after(() => host.close());
  const health = await host.connector.dispatch('health', { provider: 'database' });
  assert.equal(health.configuration.storageProvider, 'database'); assert.equal(Object.hasOwn(health.capabilities, 'export'), false);
  const result = await host.connector.dispatch('sync', { items: [item()] }); assert.equal(result.created, 1);
  await assert.rejects(host.connector.dispatch('sync', { items: [], expectedIdentity: { connectionId: 'db:wrong', base: 'other/library' } }));
  await assert.rejects(host.connector.dispatch('export'), /Unsupported database operation/);
  const retired = await host.handleRequest(new Request('https://connection.example.com/readflow/v1/export', { method: 'POST' }));
  assert.equal(retired.status, 404);
  const csv = await host.connector.dispatch('csv'); assert.equal(csv.count, 1); assert.match(csv.csv, /An article/);
  await assert.rejects(host.connector.dispatch('pending'), /Unsupported database operation/);
  await assert.rejects(host.connector.dispatch('resolve', { uuid: 'x', outcome: 'sent' }), /Unsupported database operation/);
});

test('CSV protects spreadsheet formulas, quotes newlines, and exports organization columns', () => {
  const csv = libraryCsv([{ title: '=1+1', url: 'https://example.com/', tags: ['AI'], remark: 'line 1\n"line 2"', savedAt: 0, purpose: 'reference', contentType: 'tool', starred: true,
    organizationSources: { purpose: 'user', contentType: 'user', starred: 'user' } }]);
  assert.ok(csv.startsWith('\uFEFF')); assert.match(csv, /"'=1\+1"/); assert.match(csv, /line 1\n""line 2""/);
  assert.equal(csv.split('\r\n')[0].split(',').length, 14);
  assert.match(csv, /留作资料/); assert.match(csv, /工具/); assert.match(csv, /,"是",/);
});

test('database refuses unsafe filesystem permissions', async t => {
  const { dir } = await fixture(t); await chmod(join(dir, 'readflow.sqlite'), 0o644);
  await assert.rejects(openLibrary(dir), /private/);
});

test('preferences only persist interface language', async t => {
  const { library, persistence } = await fixture(t);
  const connector = createDatabaseConnector({ library, store: library.store, exclusive: persistence.exclusive });
  await connector.dispatch('preferences', { language: 'en' });
  assert.deepEqual((await library.store.load()).preferences, { language: 'en' });
  assert.equal((await connector.dispatch('health')).configuration.language, 'en');
});

test('legacy note and remark consolidate once without discarding distinct text or old content', async t => {
  const { dir, library } = await fixture(t);
  const article = library.sync([item()]).articles[0];
  library.close();
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(join(dir, 'readflow.sqlite'));
  db.prepare('UPDATE articles SET data=? WHERE id=?').run(JSON.stringify({ ...article, remark: 'Capture reason', note: 'Reading insight', content: 'Retained old content' }), article.recordId);
  db.close();
  for (let i = 0; i < 2; i++) {
    const reopened = await openLibrary(dir);
    const saved = reopened.get(article.recordId);
    assert.equal(saved.remark, 'Capture reason\n\nReading insight');
    assert.equal(Object.hasOwn(saved, 'note'), false);
    assert.equal(saved.content, 'Retained old content');
    assert.match(libraryCsv([saved]), /Reading insight/);
    reopened.close();
  }
});


test('Feishu service exposes messages only; stale table configuration fails clearly', async t => {
  const { dir } = await fixture(t);
  const config = { stateDir: dir, baseUrl: 'https://connection.example.com/readflow/', extensionId: '', connector: { storageProvider: 'database' } };
  await assert.rejects(createHost({ ...config, feishu: { export: { baseToken: 'baseTest', articleTableId: 'tblTest' } } }), /no longer supported/);
  let called = false;
  const service = createFeishuService({ config: {}, getCredentials: () => { called = true; } });
  assert.deepEqual(Object.keys(service), ['send']);
  await assert.rejects(service.send('oc_unlisted', 'post', {}, randomUUID()));
  assert.equal(called, false);
});


test('confirmed library deletion is scoped, persistent and not resurrected by stale synced clients', async t => {
  const { dir, library, persistence } = await fixture(t);
  const source = item({ metadataUpdate: { id: randomUUID(), fields: { tags: ['Delete'], remark: 'Note' } } });
  const article = library.sync([source]).articles[0];
  library.setStatus(article.recordId, '已读');
  library.saveReview({ id: randomUUID(), digest: 'test', agentId: 'test', sources: [article] });
  const connector = createDatabaseConnector({ library, store: library.store, exclusive: persistence.exclusive });
  await assert.rejects(connector.dispatch('delete', { base: 'wrong/library', recordId: article.recordId }));
  await assert.rejects(connector.dispatch('delete', { base: library.identity.base, recordId: '../invalid' }));
  assert.equal(library.list().length, 1);
  const deleted = await connector.dispatch('delete', { base: library.identity.base, recordId: article.recordId });
  assert.equal(deleted.deleted, true); assert.equal(deleted.recordId, article.recordId);
  assert.equal(library.get(article.recordId), null); assert.equal(library.readingEvents().length, 0);
  assert.equal(library.reviews().length, 1, 'confirmed review snapshots are retained');
  assert.equal((await connector.dispatch('delete', { base: library.identity.base, recordId: article.recordId })).deleted, true);
  assert.equal(library.sync([{ ...source, libraryBase: library.identity.base, libraryRecordId: article.recordId }]).articles.length, 0);
  assert.equal((await connector.dispatch('csv')).count, 0);
  const reopened = await openLibrary(dir); assert.equal(reopened.list().length, 0); reopened.close();
});


test('HTTP deletion requires a browser signature and enforces the current library', async t => {
  const { dir } = await fixture(t);
  const config = { stateDir: dir, baseUrl: 'https://connection.example.com/readflow/', extensionId: 'a'.repeat(32), connector: { storageProvider: 'database' } };
  const host = await createHost(config); t.after(() => host.close());
  const article = host.library.sync([item()]).articles[0];
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pair = await host.pairing.request({ publicKey: keys.publicKey.export({ format: 'jwk' }) });
  await host.pairing.manage('approve', pair.pairId, pair.fingerprint);
  const request = (base, authenticated = true) => {
    const url = config.baseUrl + 'v1/delete', body = JSON.stringify({ provider: 'database', base, recordId: article.recordId });
    const stamp = String(Date.now()), nonce = randomUUID();
    const signature = sign('sha256', Buffer.from(['POST', url, stamp, nonce, createHash('sha256').update(body).digest('hex')].join('\n')), { key: keys.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    return new Request(url, { method: 'POST', body, headers: { 'Content-Type': 'application/json', Origin: 'chrome-extension://' + config.extensionId,
      ...(authenticated ? { 'X-ReadFlow-Pair': pair.pairId, 'X-ReadFlow-Time': stamp, 'X-ReadFlow-Nonce': nonce, 'X-ReadFlow-Signature': signature } : {}) } });
  };
  assert.equal((await host.handleRequest(request(host.library.identity.base, false))).status, 401);
  assert.equal((await host.handleRequest(request('other/library'))).status, 400);
  assert.ok(host.library.get(article.recordId));
  const response = await host.handleRequest(request(host.library.identity.base));
  assert.equal(response.status, 200); assert.equal((await response.json()).deleted, true);
  assert.equal(host.library.get(article.recordId), null);
});


test('organization defaults preserve legacy records and explicit edits survive replay and restart', async t => {
  const { dir, library } = await fixture(t);
  const capture = item({ metadataUpdate: { id: randomUUID(), fields: { tags: ['AI'], remark: 'Keep this note' } } });
  const original = library.sync([capture]).articles[0];
  library.setStatus(original.recordId, '已读');
  const before = library.get(original.recordId), events = library.readingEvents();
  // Simulate the JSON row written by a pre-organization release.
  const old = { ...before, remark: '旧笔记完整保留。'.repeat(40) }; delete old.purpose; delete old.contentType; delete old.starred; delete old.organizationSources;
  const raw = new DatabaseSync(join(dir, 'readflow.sqlite'));
  raw.prepare('UPDATE articles SET data=? WHERE id=?').run(JSON.stringify(old), old.recordId); raw.close();
  const reopened = await openLibrary(dir); t.after(() => reopened.close());
  assert.deepEqual(reopened.get(old.recordId), { ...old, purpose: 'later', contentType: 'web', starred: false,
    organizationSources: { purpose: 'default', contentType: 'default', starred: 'default' } });
  const edit = { ...capture, metadataUpdate: { id: randomUUID(), fields: { purpose: 'reference', contentType: 'tool', starred: true } } };
  reopened.sync([edit]);
  const result = reopened.get(old.recordId);
  assert.equal(result.remark, old.remark);
  reopened.sync([item({ metadataUpdate: { id: randomUUID(), fields: { tags: ['旧资料'] } } })]);
  assert.equal(reopened.get(old.recordId).remark, old.remark, 'tag edits leave legacy notes over 140 intact');
  reopened.sync([item({ metadataUpdate: { id: randomUUID(), fields: { tags: old.tags } } })]); assert.deepEqual(result.tags, old.tags);
  assert.equal(result.readAt, before.readAt); assert.deepEqual(reopened.readingEvents(), events);
  assert.equal(result.purpose, 'reference'); assert.equal(result.starred, true);
  assert.equal(result.organizationSources.purpose, 'user');
  const inferred = reopened.sync([{ ...capture, url: 'https://example.com/inferred', metadataUpdate: { id: randomUUID(), fields: { contentType: 'video', organizationSources: { contentType: 'inferred' } } } }]).articles.find(a => a.url.endsWith('/inferred'));
  assert.equal(inferred.contentType, 'video'); assert.equal(inferred.organizationSources.contentType, 'inferred');
  reopened.sync([{ ...capture, metadataUpdate: { id: randomUUID(), fields: { purpose: 'later', starred: false } } }]);
  reopened.sync([edit]); // An old successful request must not undo newer choices.
  reopened.sync([item()]); // A duplicate plain capture must not apply defaults again.
  assert.equal(reopened.list().length, 2); assert.equal(reopened.get(old.recordId).purpose, 'later');
  assert.equal(reopened.get(old.recordId).starred, false); assert.equal(reopened.get(old.recordId).contentType, 'tool');
  assert.equal(reopened.get(old.recordId).readAt, before.readAt);
  for (const fields of [{ purpose: 'unknown' }, { contentType: 'script' }, { starred: 'true' }, { organizationSources: { purpose: 'guess' } }]) {
    assert.throws(() => reopened.sync([item({ metadataUpdate: { id: randomUUID(), fields } })]), /Invalid capture metadata/);
  }
  const again = await openLibrary(dir); assert.deepEqual(again.get(old.recordId), reopened.get(old.recordId)); again.close();
});

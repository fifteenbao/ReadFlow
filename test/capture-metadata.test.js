import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCaptureMetadata, metadataUpdate } from '../src/lib/capture-metadata.js';
import { addItem } from '../src/lib/storage.js';
import { mergeKnowledge } from '../src/lib/knowledge.js';
import { area } from '../test-support/chrome-mock.js';
import { databaseHost } from '../test-support/database-host.js';

const capture = () => ({ id: 'capture-one', url: 'https://example.com/article', title: 'Article', savedAt: '2026-10-21T00:00:00Z', read: false,
  metadataUpdate: { id: crypto.randomUUID(), fields: { tags: ['AI', 'Research'], remark: 'What evidence supports this?' } } });

test('metadata validates at the trust boundary, deduplicates normalized tags and preserves remark whitespace', () => {
  assert.deepEqual(normalizeCaptureMetadata({ tags: [' AI ', 'AI', '研究'], remark: 'First\nSecond' }), { tags: ['AI', '研究'], remark: 'First\nSecond' });
  for (const value of [{ tags: 'AI' }, { tags: [''] }, { tags: ['x'.repeat(51)] }, { tags: ['line\nbreak'] }, { remark: 'x'.repeat(141) }, { remark: '\u0000' }, { note: 'wrong field' }, null]) assert.throws(() => normalizeCaptureMetadata(value));
  assert.equal(normalizeCaptureMetadata({ remark: '😀'.repeat(140) }).remark, '😀'.repeat(140));
  assert.throws(() => normalizeCaptureMetadata({ remark: '😀'.repeat(141) }));
  assert.throws(() => metadataUpdate({ id: 'bad', fields: { tags: ['AI'] } }));
});

test('database captures store tags/remark; retries preserve remote notes', async t => {
  const { connector, library } = await databaseHost(t);
  const item = capture();
  const first = await connector.dispatch('sync', { provider: 'database', items: [item] });
  const record = library.list().find(article => article.url === item.url);
  assert.deepEqual(record.tags, ['AI', 'Research']); assert.equal(record.remark, item.metadataUpdate.fields.remark);
  let local = mergeKnowledge([item], first); assert.equal(local[0].metadataUpdate, undefined);
  library.sync([{ ...item, metadataUpdate: { id: crypto.randomUUID(), fields: { remark: 'New server note' } } }]);
  const again = await connector.dispatch('sync', { provider: 'database', items: local });
  assert.equal(again.created, 0);
  local = mergeKnowledge(local, again);
  assert.equal(local[0].remark, 'New server note');
  assert.ok(first.captureMetadata.tagOptions.includes('AI'));
});

test('explicit edits update existing records by URL and clearing a field does not touch unrelated columns', async t => {
  const { connector, library } = await databaseHost(t);
  const item = capture();
  await connector.dispatch('sync', { provider: 'database', items: [{ id: 'seed', url: item.url, title: 'Existing title', savedAt: '2026-10-20T00:00:00Z',
    metadataUpdate: { id: crypto.randomUUID(), fields: { tags: ['Existing'], remark: 'Old' } } }] });
  const result = await connector.dispatch('sync', { provider: 'database', items: [item] });
  assert.equal(result.created, 0); assert.equal(library.list().length, 1);
  assert.equal(library.list()[0].title, 'Existing title');
  const local = mergeKnowledge([item], result);
  const edit = { ...local[0], metadataUpdate: { id: crypto.randomUUID(), fields: { remark: '' } } };
  await connector.dispatch('sync', { provider: 'database', items: [edit] });
  assert.equal(library.list()[0].remark, ''); assert.deepEqual(library.list()[0].tags, ['AI', 'Research']);
  await connector.dispatch('sync', { provider: 'database', items: [{ ...edit, metadataUpdate: { id: crypto.randomUUID(), fields: { tags: [] } } }] });
  assert.deepEqual(library.list()[0].tags, []);
});

test('local offline edits persist, reopen correctly and only matching acknowledgements clear them', async t => {
  const before = globalThis.chrome; t.after(() => { globalThis.chrome = before; });
  const values = { items: [] }; globalThis.chrome = { storage: { local: area(values) } };
  const first = await addItem({ url: 'https://example.com/a', title: 'A', metadata: { tags: ['AI'], remark: 'Question' } });
  const second = await addItem({ url: first.url, title: 'A', metadata: { remark: 'New question' } });
  assert.equal(values.items.length, 1); assert.equal(first.id, second.id); assert.deepEqual(second.metadataUpdate.fields, { tags: ['AI'], remark: 'New question' });
  const snapshot = { base: 'baseTest/tblTest', bindings: [{ id: first.id, recordId: 'recOne' }], metadataBindings: [{ id: first.id, editId: first.metadataUpdate.id }],
    articles: [{ recordId: 'recOne', url: first.url, title: 'A', tags: ['Server'], remark: 'Server', read: false }] };
  const merged = mergeKnowledge([second], snapshot)[0];
  assert.equal(merged.metadataUpdate.id, second.metadataUpdate.id); assert.deepEqual(merged.tags, ['AI']); assert.equal(merged.remark, 'New question');
});

test('tag counts are unrestricted while individual values remain validated', () => {
  const tags = Array.from({ length: 250 }, (_, i) => 'Tag ' + i);
  assert.deepEqual(normalizeCaptureMetadata({ tags }).tags, tags);
});

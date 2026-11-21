import test from 'node:test';
import assert from 'node:assert/strict';
import { initialRoute, initialView } from '../src/lib/navigation.js';
import { isUnread, readingStatus } from '../src/lib/reading-state.js';
import { databaseHost } from '../test-support/database-host.js';
import { inferContentType } from '../src/lib/organization.js';

test('collection is the default home, including offline use; settings remains explicit', () => {
  assert.equal(initialRoute('', false), 'reading-list'); assert.equal(initialRoute('', true), 'reading-list');
  assert.equal(initialRoute('#unknown', false), 'reading-list');
  for (const route of ['reading-list', 'settings']) assert.equal(initialRoute('#' + route, false), route);
  assert.equal(initialView('#reading-list/reference'), 'reference');
  assert.equal(initialView('#reading-list'), null);
  assert.equal(initialView('#reading-list/starred'), null, 'legacy starred hash is not a top-level view');
  assert.equal(initialView('#reading-list/all'), 'all');
});
test('URL content-type hints stay conservative and never force tools by domain alone', () => {
  assert.equal(inferContentType('https://www.youtube.com/watch?v=abc'), 'video');
  assert.equal(inferContentType('https://medium.com/@author/post-title'), 'article');
  assert.equal(inferContentType('https://example.com/docs/tool'), 'web');
  assert.equal(inferContentType('https://figma.com/file/abc'), 'web');
});
test('read and skipped items leave the unread collection without deletion', () => {
  const items = [
    { id: 'unread', read: false, url: 'https://example.com/a' },
    { id: 'read', read: true, status: '已读', url: 'https://example.com/b' },
    { id: 'skip', read: true, status: '跳过', url: 'https://example.com/c' },
    { id: 'inconsistent-skip', read: false, status: '跳过', url: 'https://example.com/d' },
    { id: 'deleted', read: false, libraryDeleted: true, url: 'https://example.com/e' },
  ];
  assert.deepEqual(items.filter(isUnread).map(i => i.id), ['unread']);
  assert.equal(readingStatus(items[2]), '跳过'); assert.equal(items.length, 5);
});
test('skip synchronizes database status and can be explicitly restored to unread', async t => {
  const { connector, library } = await databaseHost(t);
  const synced = await connector.dispatch('sync', { provider: 'database', items: [{ id: 'nav-1', title: 'Nav', url: 'https://example.com/nav', savedAt: '2026-10-13T00:00:00Z' }] });
  const recordId = synced.articles[0].recordId, base = synced.base;
  await connector.dispatch('read', { provider: 'database', base, recordId, status: '跳过' });
  assert.equal(library.get(recordId).status, '跳过');
  const snapshot = await connector.dispatch('sync', { provider: 'database', items: [] });
  assert.equal(snapshot.articles[0].read, true);
  assert.equal(snapshot.articles[0].status, '跳过');
  await connector.dispatch('read', { provider: 'database', base, recordId, status: '待阅读' });
  assert.equal((await connector.dispatch('sync', { provider: 'database', items: [] })).articles[0].read, false);
  assert.equal(library.list().length, 1);
});

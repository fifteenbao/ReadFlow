import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeArticleUrl } from '../src/lib/security.js';
import { mergeKnowledge } from '../src/lib/knowledge.js';
import { prepareCapture } from '../src/lib/storage.js';
import { readingStatus, isUnread } from '../src/lib/reading-state.js';
import { normalizeLibraryItem } from '../src/lib/library-binding.js';
import { LIBRARY_ITEM_LIMIT } from '../src/lib/library-limits.js';
import { area } from '../test-support/chrome-mock.js';

test('article URLs normalize the same way locally and for lookup', () => {
  assert.equal(normalizeArticleUrl('https://example.com/a'), 'https://example.com/a');
  assert.equal(normalizeArticleUrl('https://EXAMPLE.com:443/a'), 'https://example.com/a');
  assert.equal(normalizeArticleUrl('javascript:alert(1)'), null);
});

test('reading status prefers status over the legacy read flag', () => {
  assert.equal(readingStatus({ status: '跳过', read: false }), '跳过');
  assert.equal(isUnread({ status: '跳过', read: false }), false);
  assert.equal(isUnread({ status: '待阅读', read: true }), true);
  assert.deepEqual(normalizeLibraryItem({ status: '已读', read: false, snoozedUntil: 1 }),
    { status: '已读', read: true });
});

test('prepareCapture and mergeKnowledge share the library item limit', async t => {
  const before = globalThis.chrome;
  t.after(() => { globalThis.chrome = before; });
  globalThis.chrome = { storage: { local: area({ items: [] }) } };
  const items = Array.from({ length: LIBRARY_ITEM_LIMIT }, (_, i) => ({
    id: `id-${i}`, url: `https://example.com/${i}`, title: `${i}`, savedAt: '2026-01-01T00:00:00Z', status: '待阅读', read: false,
  }));
  assert.throws(() => prepareCapture(items, { url: 'https://example.com/overflow', title: 'Overflow' }), /Library is full/);
  const snapshot = {
    base: 'lib/library',
    bindings: [],
    articles: [{ recordId: 'recOverflow', url: 'https://example.com/overflow', title: 'Overflow', read: false, status: '待阅读', savedAt: Date.now() }],
  };
  assert.throws(() => mergeKnowledge(items, snapshot), /Library is full/);
});

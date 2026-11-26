import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHash } from '../src/lib/navigation.js';
import { inferContentType } from '../src/lib/organization.js';

test('collection is the default home, including offline use; settings remains explicit', () => {
  assert.equal(parseHash('').route, 'reading-list');
  assert.equal(parseHash('#unknown').route, 'reading-list');
  for (const route of ['reading-list', 'settings']) assert.equal(parseHash('#' + route).route, route);
  assert.equal(parseHash('#reading-list/reference').view, 'reference');
  assert.equal(parseHash('#reading-list').view, null);
  assert.equal(parseHash('#reading-list/starred').view, null);
  assert.equal(parseHash('#reading-list/all').view, null);
  assert.deepEqual(parseHash('#reading-list/reference/edit/library%3Aone%2Ftwo'), { route: 'edit-item', view: 'reference', itemId: 'library:one/two' });
  assert.equal(parseHash('#reading-list/reference/edit/%FF').route, 'reading-list');
});
test('URL content-type hints stay conservative and never force tools by domain alone', () => {
  assert.equal(inferContentType('https://www.youtube.com/watch?v=abc'), 'video');
  assert.equal(inferContentType('https://medium.com/@author/post-title'), 'article');
  assert.equal(inferContentType('https://example.com/docs/tool'), 'web');
  assert.equal(inferContentType('https://figma.com/file/abc'), 'web');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { isSafeArticleUrl, safeErrorMessage, readJsonResponse } from '../src/lib/security.js';

test('credential URLs, OAuth callbacks, unsafe schemes, and control characters never enter the library', () => {
  const bad = ['javascript:alert(1)', 'data:text/html,test', 'https://user:secret@example.com/path',
    'https://example.com/?access_token=private', 'https://example.com/?%61ccess_token=private',
    'https://example.com/#refresh_token=private', 'https://example.com/?code=private&state=abc',
    'https://example.com/?X-Amz-Signature=private', 'https://example.com/\npath',
    'http://localhost:8888/settings', 'http://127.1/private', 'http://2130706433/private',
    'http://0x7f000001/private', 'http://192.168.1.1/', 'http://10.0.0.1/', 'http://[::1]/', 'https://device.local/'];
  for (const url of bad) assert.equal(isSafeArticleUrl(url), false);
  assert.equal(isSafeArticleUrl('https://example.com/article?q=learning#section'), true);
});

test('unexpected errors and malformed response bodies withhold reflected credentials', async () => {
  assert.equal(safeErrorMessage(new Error('Bearer private-token')), 'The operation failed. Retry or check your connection and permissions.');
  await assert.rejects(readJsonResponse(new Response('private-reflected-token'), 5), /too large/);
  await assert.rejects(readJsonResponse(new Response('private-reflected-token')), error => !error.message.includes('private-reflected-token'));
});

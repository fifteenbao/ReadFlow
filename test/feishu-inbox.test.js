import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFeishuInbox, extractArticleLinks } from '../server/feishu-inbox.js';
import { openLibrary } from '../server/database.js';
import { createFileState } from '../server/file-state.js';

const credentials = { encryptKey: 'test-event-encryption', verificationToken: 'test-verification-token' };
const time = Date.UTC(2026, 9, 21, 2);
const event = () => ({ schema: '2.0', header: { event_id: 'event-1', event_type: 'im.message.receive_v1', app_id: 'cli_Test', token: credentials.verificationToken },
  event: { sender: { sender_type: 'user', sender_id: { open_id: 'ou_test' } }, message: { message_id: 'om_test', chat_id: 'oc_test', chat_type: 'p2p', message_type: 'text', content: JSON.stringify({ text: 'Read https://example.com/new' }) } } });
function signed(value, options = {}) {
  const iv = randomBytes(16), key = createHash('sha256').update(credentials.encryptKey).digest();
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([iv, cipher.update(JSON.stringify(value)), cipher.final()]).toString('base64');
  const body = JSON.stringify({ encrypt: encrypted });
  const timestamp = String((options.time ?? time) / 1000), nonce = 'test-nonce';
  const signature = createHash('sha256').update(timestamp + nonce + credentials.encryptKey + body).digest('hex');
  return new Request('https://connection.example.com/readflow/events/feishu', { method: 'POST', headers: {
    'Content-Type': 'application/json', 'X-Lark-Request-Timestamp': timestamp, 'X-Lark-Request-Nonce': nonce,
    'X-Lark-Signature': options.signature ?? signature,
  }, body });
}
async function setup(t, overrides = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'readflow-inbox-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const persistence = await createFileState({ stateDir: dir, authentication: 'paired' });
  await persistence.initialize();
  const library = await openLibrary(dir, { initialize: true, now: () => time });
  t.after(() => library.close());
  const config = { connectionId: 'app:cli_Test', baseToken: library.libraryId, articleTableId: 'library' };
  const settings = {
    config, store: library.store, exclusive: persistence.exclusive,
    inboxConfig: { enabled: true, allowedChatIds: ['oc_test'], allowedOpenIds: ['ou_test'] },
    capture: items => library.sync(items),
    applyAction: (...args) => library.applyAction(...args),
    getEventCredentials: () => credentials, now: () => time, ...overrides,
  };
  return { library, config, settings, inbox: createFeishuInbox(settings), store: library.store };
}

test('encrypted callbacks verify challenge without a library write, and normal events require a fresh signature', async t => {
  const f = await setup(t);
  const response = await f.inbox.handleRequest(signed({ type: 'url_verification', token: credentials.verificationToken, challenge: 'test-challenge' }));
  assert.deepEqual(await response.json(), { challenge: 'test-challenge' }); assert.equal(f.library.list().length, 0);
  assert.equal((await f.inbox.handleRequest(signed(event(), { signature: '0'.repeat(64) }))).status, 401);
  assert.equal((await f.inbox.handleRequest(signed(event(), { time: time - 301000 }))).status, 401);
  const wrong = event(); wrong.header.token = 'wrong';
  assert.equal((await f.inbox.handleRequest(signed(wrong))).status, 401);
  const plaintext = new Request('https://connection.example.com/readflow/events/feishu', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event()) });
  assert.equal((await f.inbox.handleRequest(plaintext)).status, 401);
  assert.equal((await f.store.load()).feishuInbox, undefined);
});

test('only allowed human direct-message senders and chats enter the durable inbox', async t => {
  const f = await setup(t);
  for (const mutate of [
    e => { e.event.sender.sender_type = 'app'; },
    e => { e.event.sender.sender_id.open_id = 'ou_other'; },
    e => { e.event.message.chat_id = 'oc_other'; },
    e => { e.event.message.chat_type = 'group'; },
    e => { e.event.message.message_type = 'post'; },
    e => { e.header.event_type = 'other'; },
  ]) {
    const value = event(); mutate(value); assert.equal((await f.inbox.handleRequest(signed(value))).status, 200);
  }
  assert.equal((await f.store.load()).feishuInbox, undefined);
  const wrongApp = event(); wrongApp.header.app_id = 'cli_Other';
  assert.equal((await f.inbox.handleRequest(signed(wrongApp))).status, 403);
  assert.throws(() => createFeishuInbox({ ...f.settings, inboxConfig: { enabled: true, allowedChatIds: [], allowedOpenIds: [] } }));
});

test('durable acknowledgement, message-id retry deduplication, URL deduplication across Chrome and Feishu, and browser status sync', async t => {
  const f = await setup(t); const first = event();
  assert.equal((await f.inbox.handleRequest(signed(first))).status, 200);
  assert.equal(f.library.list().length, 0);
  const retry = event(); retry.header.event_id = 'another-event-id';
  await f.inbox.handleRequest(signed(retry));
  assert.equal(Object.keys((await f.store.load()).feishuInbox.messages).length, 1);
  f.library.sync([{ id: 'chrome-id', title: 'Chrome title', url: 'https://example.com/new', savedAt: new Date(time).toISOString() }]);
  const result = await f.inbox.processPending();
  assert.deepEqual(result, { ok: true, processed: 1, created: 0 });
  const recreated = createFeishuInbox(f.settings);
  assert.deepEqual(await recreated.processPending(), { ok: true, processed: 0, created: 0 });
  const second = event(); second.event.message.message_id = 'om_second'; second.event.message.content = JSON.stringify({ text: 'https://example.com/second' });
  await recreated.handleRequest(signed(second));
  assert.equal((await recreated.processPending()).created, 1);
  const saved = f.library.list().find(a => a.url === 'https://example.com/second'); assert.equal(saved.status, '待阅读');
  f.library.setStatus(saved.recordId, '跳过');
  assert.equal(f.library.get(saved.recordId).status, '跳过');
});

test('failed persistence is not acknowledged; failed capture stays pending; crash-after-create retries do not duplicate records', async t => {
  const f = await setup(t); const originalSave = f.store.save; let fail = true;
  f.store.save = async value => { if (fail) throw new Error('private payload'); return originalSave(value); };
  assert.equal((await f.inbox.handleRequest(signed(event()))).status, 503);
  fail = false; assert.equal((await f.inbox.handleRequest(signed(event()))).status, 200);
  let failCapture = true;
  const settings = { ...f.settings, capture: async items => {
    if (failCapture) throw new Error('private provider payload');
    return f.library.sync(items);
  } };
  const inbox = createFeishuInbox(settings);
  await assert.rejects(inbox.processPending());
  assert.equal(Object.values((await f.store.load()).feishuInbox.messages)[0].status, 'pending');
  failCapture = false; fail = true;
  await assert.rejects(inbox.processPending());
  assert.equal(f.library.list().filter(r => r.url === 'https://example.com/new').length, 1);
  fail = false; assert.equal((await inbox.processPending()).created, 0);
  assert.equal(f.library.list().filter(r => r.url === 'https://example.com/new').length, 1);
});

test('bounded safe-link extraction never fetches content; non-links and credential-bearing/local URLs are ignored', async t => {
  assert.deepEqual(extractArticleLinks('see <https://example.com/a> https://example.com/a https://example.com/b。'), ['https://example.com/a', 'https://example.com/b']);
  assert.deepEqual(extractArticleLinks('[source](https://example.com/a) https://example.com/item_(a)'), ['https://example.com/a', 'https://example.com/item_(a)']);
  assert.deepEqual(extractArticleLinks('https://127.0.0.1/ https://user:secret@example.com/ https://example.com/?token=secret https://localhost/'), []);
  assert.throws(() => extractArticleLinks(Array.from({ length: 11 }, (_, i) => `https://example.com/${i}`).join(' ')));
  const f = await setup(t); const value = event(); value.event.message.content = JSON.stringify({ text: 'ordinary conversation' });
  await f.inbox.handleRequest(signed(value)); assert.equal((await f.store.load()).feishuInbox, undefined);
  const tooLarge = new Request('https://connection.example.com/readflow/events/feishu', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': '65537' }, body: '{}' });
  assert.equal((await f.inbox.handleRequest(tooLarge)).status, 413);
});

test('changed destination cannot silently drain the previous inbox into another library scope', async t => {
  const f = await setup(t); await f.inbox.handleRequest(signed(event()));
  const other = createFeishuInbox({ ...f.settings, config: { ...f.config, articleTableId: 'other' } });
  await assert.rejects(other.processPending(), /scope changed/); assert.equal(f.library.list().length, 0);
});

test('database intake confirms only after capture; lost receipt retries keep the UUID and skip recapture', async t => {
  let captures = 0, failed = true; const receipts = [];
  const f = await setup(t, { capture: async () => { captures++; return { created: 1 }; },
    sendReceipt: async (...args) => { receipts.push(args); if (failed) throw new Error('Unknown delivery'); } });
  await f.inbox.handleRequest(signed(event())); assert.equal(captures, 0); assert.equal(receipts.length, 0);
  await assert.rejects(f.inbox.processPending()); assert.equal(captures, 1);
  failed = false; await f.inbox.processPending();
  assert.equal(captures, 1); assert.equal(receipts.length, 2); assert.equal(receipts[0][1], receipts[1][1]);
  assert.equal(receipts[0][0], 'oc_test'); assert.equal((await f.inbox.receipts()).length, 0);
});

test('reading card callbacks require signed event, allowed sender/chat and a persisted issued-card binding', async t => {
  const applied = [];
  const f = await setup(t, { capture: async () => ({ created: 0 }), applyAction: async (...args) => applied.push(args) });
  const state = await f.store.load(); state.scopes.cards = { target: { chatId: 'oc_test' }, cards: { om_card: { requestId: 'request1', recordIds: ['recItem'] } } }; await f.store.save(state);
  const card = () => ({ schema: '2.0', header: { ...event().header, event_type: 'card.action.trigger' }, event: {
    operator: { open_id: 'ou_test' }, context: { open_chat_id: 'oc_test', open_message_id: 'om_card' },
    action: { value: { action: 'read', recordId: 'recItem', requestId: 'request1' } },
  } });
  assert.equal((await f.inbox.handleRequest(signed(card()))).status, 200); assert.equal(applied.length, 1);
  const wrongUser = card(); wrongUser.event.operator.open_id = 'ou_other'; assert.equal((await f.inbox.handleRequest(signed(wrongUser))).status, 403);
  const wrongRecord = card(); wrongRecord.event.action.value.recordId = 'recOther'; assert.equal((await f.inbox.handleRequest(signed(wrongRecord))).status, 503);
  const wrongMessage = card(); wrongMessage.event.context.open_message_id = 'om_other'; assert.equal((await f.inbox.handleRequest(signed(wrongMessage))).status, 503);
  assert.equal(applied.length, 1);
});

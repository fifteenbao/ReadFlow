import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { formatDiagnostic } from '../src/lib/diagnostics.js';
import { area, event } from '../test-support/chrome-mock.js';

// Interaction test against the real options module; no visual/browser claim.
test('settings pair with approval, use one language selector and group provider links without parsed-ID inputs', async t => {
  const original = { history: globalThis.history, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, confirm: globalThis.confirm, chrome: globalThis.chrome, document: globalThis.document, location: globalThis.location, addEventListener: globalThis.addEventListener };
  const timers = new Map(); let nextTimer = 0;
  globalThis.setTimeout = (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; };
  globalThis.clearTimeout = id => timers.delete(id);
  const poll = async () => { const entry = [...timers].find(([, value]) => [0, 3000].includes(value.ms)); assert.ok(entry, 'approval check scheduled'); timers.delete(entry[0]); await entry[1].fn(); };
  let allowDisconnect = false; globalThis.confirm = () => allowDisconnect;
  const viewEvents = {}; globalThis.addEventListener = (name, fn) => { viewEvents[name] = fn; };
  t.after(() => Object.assign(globalThis, original));
  class Element {
    constructor() { this.style = {}; this.children = []; this.value = ''; this.textContent = ''; this.disabled = false; this.checked = false; this.listeners = {}; this.attrs = {}; this.classList = { add() {}, remove() {} }; }
    setAttribute(k,v) { this.attrs[k] = v; } getAttribute(k) { return this.attrs[k]; } removeAttribute(k) { delete this.attrs[k]; }
    append(...values) { this.children.push(...values); } appendChild(value) { this.children.push(value); } replaceChildren(...values) { this.children = values; } focus() { this.focused = true; } select() { this.selected = true; } scrollIntoView() {}
    addEventListener(name, fn) { this.listeners[name] = fn; }
  }
  const elements = new Map();
  const el = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const version = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8')).version;
  const html = await readFile(new URL('../src/options.html', import.meta.url), 'utf8');
  const pageIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  const translatable = [];
  for (const tag of html.matchAll(/<[^>]+data-i18n(?:-placeholder)?="[^"]+"[^>]*>/g)) {
    const id = tag[0].match(/\bid="([^"]+)"/)?.[1];
    const node = id ? el(id) : new Element();
    for (const attr of tag[0].matchAll(/(data-i18n(?:-placeholder)?)="([^"]+)"/g)) node.setAttribute(attr[1], attr[2]);
    translatable.push(node);
  }
  globalThis.document = { documentElement: { lang: 'en' }, querySelectorAll: selector => translatable.filter(node => node.getAttribute(selector.slice(1, -1))), getElementById: id => pageIds.has(id) ? el(id) : null, createElement: () => new Element(), createElementNS: () => new Element(), createTextNode: text => text };
  globalThis.location = { hash: '' };
  globalThis.history = { replaceState: (_a, _b, hash) => { location.hash = hash; } };
  let operatorApproved = false, pairUnavailable = false, pairId = 'a'.repeat(36), deletionFails = false, syncFails = false, permissionGranted = true, connected = false, saved = false, provider = 'database', lastSaved, calls = [];
  let missingExtensionId = false, serverTime;
  const extensionId = 'a'.repeat(32);
  const local = { connectionEndpoint: 'https://connection.example.com/readflow/', items: [
    { id: 'unread', title: 'Unread', tags: ['AI'], remark: '<script>note</script>', url: 'https://example.com/a', read: false, savedAt: '2026-10-14T00:00:00Z' },
    { id: 'read', title: 'Read', remark: '旧'.repeat(150), url: 'https://example.com/b', read: true, status: '已读', savedAt: '2026-10-14T00:00:00Z' },
    { id: 'skip', title: 'Skip', url: 'https://example.com/c', read: true, status: '跳过', savedAt: '2026-10-14T00:00:00Z' },
  ], knowledgeSync: { folders: [] } };
  const status = () => ({ ok: true, connected, protocolVersion: 1, configuration: { storageProvider: provider, language: lastSaved?.language || 'en' } });
  globalThis.chrome = {
    permissions: { request: async () => permissionGranted, contains: async () => true, remove: async () => true },
    storage: { local: area(local), onChanged: event() },
    i18n: { getUILanguage: () => 'en-US' },
    runtime: { id: extensionId, getManifest: () => ({ version }), sendMessage: async message => {
      calls.push(message);
      if (message.type === 'PAIR_STATUS') return { ok: true, approved: saved, status: saved ? 'approved' : 'unpaired', baseUrl: local.connectionEndpoint || '' };
      if (message.type === 'PAIR_REQUEST' && pairUnavailable) throw new Error('Network unavailable');
      if (message.type === 'PAIR_REQUEST' && missingExtensionId) return { ok: false, diagnostic: { code: 'EXTENSION_ID_UNSET', stage: 'identity' } };
      if (message.type === 'PAIR_REQUEST') return { ok: true, status: operatorApproved ? 'approved' : 'pending', fingerprint: 'f'.repeat(64), pairId };
      if (message.type === 'VALIDATE_CONNECTION') {
        if (serverTime) {
          const diagnostic = { code: 'CLOCK_SKEW', stage: 'identity', serverTime };
          return { ok: false, diagnostic, error: formatDiagnostic(diagnostic) };
        }
        if (message.accessKey === 'bad') return { ok: false, error: formatDiagnostic({ code: 'KEY_INVALID', stage: 'identity' }) };
        if (message.accessKey === 'wrong-origin') return { ok: false, error: formatDiagnostic({ code: 'ORIGIN_DENIED', stage: 'identity' }) };
        provider = 'database'; connected = true;
        return status();
      }
      if (message.type === 'SYNC' && syncFails) return { ok: false, error: 'Network unavailable' };
      if (message.type === 'CONNECTION_STATUS') return status();
      if (message.type === 'UPDATE_METADATA') {
        if (deletionFails) return { ok: false, error: 'Network unavailable' };
        Object.assign(local.items.find(item => item.id === message.id), message.metadata); return { ok: true };
      }
      if (message.type === 'DELETE_ITEM') { if (deletionFails) return { ok: false, error: 'Network unavailable' }; local.items = local.items.filter(item => item.id !== message.id); return { ok: true }; }
      if (message.type === 'SAVE_SETTINGS') { delete local.pendingConnectionSetup; saved = true; lastSaved = message.settings; local.connectionEndpoint = lastSaved.connectionUrl; return { ok: true, settings: lastSaved }; }
      return { ok: true };
    } },
  };
  const drain = () => new Promise(resolve => setImmediate(resolve));
  await import('../src/options.js'); await drain();
  assert.equal(el('setup-guide').hidden, false);
  assert.equal(el('settings').hidden, true);
  assert.equal(el('reading-list').hidden, false);
  assert.equal(el('list').children.length, 3, 'legacy statuses do not hide saved items');
  assert.doesNotMatch(html, /id="(?:view-all|filter-unread|filter-read|filter-status|reading-status-tabs)"/);
  assert.equal(el('collection-filters').hidden, true);
  assert.equal(el('edit-item').hidden, true);
  const rowFor = title => el('list').children.find(row => row.children[0].children[0]?.textContent === title);
  const activate = async hash => { location.hash = hash; await viewEvents.hashchange(); };
  const openEdit = title => activate(rowFor(title).children[3].children[0].href);
  const formEvent = () => ({ preventDefault() {} });
  const submit = () => el('edit-form').listeners.submit(formEvent());
  const note = el('edit-note'), tags = el('edit-tags');

  assert.equal(rowFor('Unread').children[1].children[0].textContent, 'AI');
  assert.equal(rowFor('Unread').children[2].textContent, '<script>note</script>');
  assert.equal(rowFor('Unread').children[2].children.length, 0);
  await openEdit('Unread');
  assert.equal(el('reading-list').hidden, true);
  assert.equal(el('edit-item').hidden, false);
  assert.equal(el('edit-heading').focused, true);
  assert.equal(note.value, '<script>note</script>');
  note.value = '新笔记\n保留输入'; note.listeners.input();
  tags.value = ' AI \n研究\nAI'; tags.listeners.input();
  deletionFails = true; await submit();
  assert.equal(note.value, '新笔记\n保留输入');
  assert.equal(tags.value, ' AI \n研究\nAI');
  assert.match(el('edit-feedback').textContent, /保存失败，输入仍保留/);
  assert.equal(local.items[0].remark, '<script>note</script>');
  assert.equal(el('edit-save').disabled, false);
  deletionFails = false; await submit();
  assert.equal(el('edit-item').hidden, true);
  assert.equal(el('reading-list').hidden, false);
  assert.equal(el('list-heading').focused, true);
  assert.equal(rowFor('Unread').children[2].textContent, '新笔记\n保留输入');
  assert.deepEqual(local.items[0].tags, ['AI', '研究']);

  await openEdit('Unread');
  note.value = '字'.repeat(141); note.listeners.input();
  const writes = calls.filter(c => c.type === 'UPDATE_METADATA').length;
  await submit();
  assert.equal(note.getAttribute('aria-invalid'), 'true');
  assert.equal(calls.filter(c => c.type === 'UPDATE_METADATA').length, writes);
  note.value = '😀'.repeat(140); note.listeners.input(); await submit();
  assert.equal(local.items[0].remark, '😀'.repeat(140));
  await openEdit('Unread');
  tags.value = ''; tags.listeners.input(); await submit();
  assert.deepEqual(local.items[0].tags, []);
  assert.equal(local.items[0].remark, '😀'.repeat(140), 'tag edits cannot replace notes');
  await openEdit('Read');
  assert.match(el('edit-note-count').textContent, /原样保留/);
  tags.value = '新标签'; tags.listeners.input(); await submit();
  assert.equal(local.items[1].remark.length, 150);
  assert.deepEqual(calls.findLast(c => c.type === 'UPDATE_METADATA').metadata, { tags: ['新标签'] });
  await openEdit('Unread');
  note.value = '不保存'; note.listeners.input();
  await el('edit-cancel').listeners.click(formEvent());
  assert.equal(local.items[0].remark, '😀'.repeat(140));
  await activate('#reading-list/all');
  assert.equal(el('view-later').getAttribute('aria-pressed'), 'true');
  await activate('#reading-list/later/edit/missing');
  assert.equal(el('edit-missing').hidden, false);
  assert.equal(el('edit-form').hidden, true);
  await el('edit-back').listeners.click(formEvent());


  location.hash = '#reading-list'; viewEvents.hashchange();
  assert.equal(el('settings').hidden, true); assert.equal(el('reading-list').hidden, false);
  location.hash = '#settings'; viewEvents.hashchange();
  assert.match(el('pair-status').textContent, /未配对/); assert.equal(el('export-csv').disabled, true);
  assert.ok(el('connection-meta').textContent.includes(version));
  assert.doesNotMatch(html, /id="(?:provider|tableUrl)"/);
  assert.doesNotMatch(html, /id="export-table"/);
  missingExtensionId = true;
  await el('check-connection').listeners.click();
  assert.match(el('auth-status').textContent, /服务端尚未登记扩展 ID.*host\.json.*a{32}/);
  missingExtensionId = false;
  await el('check-connection').listeners.click(); assert.match(el('pair-status').textContent, /等待服务器/);
  assert.match(el('auth-status').textContent, /等待服务器批准/);
  const oldClipboard = navigator.clipboard; let copied;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { copied = text; } } });
  t.after(() => { if (oldClipboard) Object.defineProperty(navigator, 'clipboard', { configurable: true, value: oldClipboard }); else delete navigator.clipboard; });
  await el('copy-pair-task').listeners.click();
  assert.ok(copied.includes('f'.repeat(64))); assert.ok(copied.includes(local.connectionEndpoint));
  assert.match(el('pair-fingerprint').textContent, /ffff ffff/);
  assert.match(el('pair-fingerprint').textContent, /核对码：7777/);
  assert.match(copied, /pair-wait.*--pair-id/);
  navigator.clipboard.writeText = async () => { throw new Error('denied'); };
  await el('copy-pair-task').listeners.click();
  assert.equal(el('pair-task-preview').open, true); assert.equal(el('pair-task').selected, true);

  assert.doesNotMatch(html, /id="save"/);
  await poll(); assert.equal(saved, false, 'pending approval must never save');
  pairUnavailable = true; await poll(); assert.equal(saved, false); assert.match(el('auth-status').textContent, /自动重试/); pairUnavailable = false;
  assert.match(el('pair-task').value, /pair-approve.*--fingerprint/);
  assert.ok(el('pair-task').value.includes('f'.repeat(64)));
  operatorApproved = true;
  assert.doesNotMatch(html, /id="(?:chatId|remindersEnabled|reminderTime|timeZone|remindersAvailable)"/);
  serverTime = Date.parse('2026-11-22T09:00:00Z');
  await poll();
  assert.equal(saved, false);
  assert.match(el('auth-status').textContent, /请校准.*服务器时间=2026-11-22T09:00:00/);
  assert.equal([...timers.values()].some(timer => timer.ms === 3000), false);
  serverTime = undefined;
  await el('check-connection').listeners.click();
  await poll(); await drain();
  assert.match(el('auth-status').textContent, /自动连接/);
  assert.equal(el('setup-guide').hidden, true);
  assert.ok(calls.some(c => c.type === 'SYNC'), 'successful pairing refreshes automatically');
  location.hash = '#reading-list'; await viewEvents.hashchange();
  const snapshot = structuredClone(local.items);
  syncFails = true; await viewEvents.focus();
  assert.equal(el('retry-refresh').hidden, false);
  assert.match(el('refresh-status').textContent, /上次获取/);
  assert.deepEqual(local.items, snapshot);
  syncFails = false; await el('retry-refresh').listeners.click();
  assert.equal(el('retry-refresh').hidden, true);
  assert.match(el('refresh-status').textContent, /资料已更新/);
  assert.equal(el('export-csv').disabled, false); assert.equal(el('export-csv').disabled, false);
  const beforeLanguageChange = calls.length;
  el('ui-language').value = 'zh'; await el('ui-language').listeners.change();
  assert.equal(document.documentElement.lang, 'zh'); assert.equal(local.uiLanguage, 'zh');
  assert.equal(calls.length, beforeLanguageChange);
  assert.equal(lastSaved.language, 'zh');
  assert.equal(el('check-connection').textContent, '连接服务器，获取指纹');
  assert.match(el('pair-status').textContent, /服务器已批准/);
  el('ui-language').value = 'en'; await el('ui-language').listeners.change();
  assert.equal(el('check-connection').textContent, 'Connect to server · Get fingerprint');
  assert.equal(local.uiLanguage, 'en');
  assert.equal(Object.hasOwn(lastSaved, 'remindersEnabled'), false);
  assert.ok(calls.some(c => c.type === 'VALIDATE_CONNECTION'));
  const organizationControls = () => rowFor('Unread').children[0].children[2];
  await organizationControls().children[0].listeners.click();
  el('filter-starred').checked = true; await el('filter-starred').listeners.change();
  assert.equal(el('list-count').textContent, 'Items (3)');
  const purpose = organizationControls().children[1]; purpose.value = 'reference'; await purpose.listeners.change();
  const parentId = 'folder_' + '1'.repeat(32), childId = 'folder_' + '2'.repeat(32);
  local.knowledgeSync.folders = [{ id: parentId, name: 'Design', parentId: null }, { id: childId, name: 'Research', parentId }];
  local.items.find(item => item.id === 'unread').folderId = parentId;
  await el('view-reference').listeners.click(); assert.equal(el('list-count').textContent, 'Items (1)');
  assert.equal(el('filter-starred').checked, false, 'switching sections clears starred filter');
  const picker = el('folder-picker');
  const parent = () => el('library-folders').children[0].children[2];
  const toggle = () => parent().children[0].children[0];
  const choose = () => parent().children[0].children[1];
  assert.equal(picker.getAttribute('aria-expanded'), 'false');
  assert.equal(toggle().getAttribute('aria-expanded'), 'false');
  await choose().listeners.click();
  assert.equal(el('folder-picker-name').textContent, 'Design');
  assert.equal(toggle().getAttribute('aria-expanded'), 'false', 'selecting a folder does not expand it');
  toggle().listeners.click();
  assert.equal(el('folder-title').textContent, 'Design', 'expanding a folder does not change the selection');
  const children = parent().children[1];
  assert.equal(children.hidden, false);
  assert.equal(children.children[0].children[0].children[0].children[1].textContent, 'Research');
  const record = children.children[1].children[0];
  assert.equal(record.children[1].textContent, 'Unread');
  assert.notEqual(record.children[0].children[0].getAttribute('d'), choose().children[0].children[0].getAttribute('d'));
  picker.getClientRects = () => [{}];
  picker.listeners.click();
  await record.listeners.click();
  assert.equal(picker.getAttribute('aria-expanded'), 'false');
  assert.equal(picker.focused, true);
  assert.equal(el('list-count').textContent, 'Items (1)');
  assert.equal(toggle().getAttribute('aria-expanded'), 'true', 'picker can close without collapsing a folder');
  picker.listeners.click();
  el('library-sidebar').listeners.keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(picker.getAttribute('aria-expanded'), 'false');
  const folderButton = el('open-folder-form');
  assert.equal(folderButton.disabled, false);
  assert.equal(el('folder-form').hidden, true);
  folderButton.listeners.click();
  assert.equal(folderButton.getAttribute('aria-expanded'), 'true');
  assert.equal(el('folder-name').focused, true);
  el('folder-name').listeners.keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(el('folder-form').hidden, true);
  assert.equal(folderButton.focused, true);
  await openEdit('Unread');
  await el('edit-back').listeners.click(formEvent());
  assert.equal(el('view-reference').getAttribute('aria-pressed'), 'true');
  const type = organizationControls().children[2]; type.value = 'tool'; await type.listeners.change();
  el('filter-type').value = 'video'; await el('filter-type').listeners.change(); assert.equal(el('list-count').textContent, 'Items (0)');
  el('filter-type').value = 'tool'; await el('filter-type').listeners.change(); assert.equal(el('list-count').textContent, 'Items (1)');
  deletionFails = true;
  const failedPurpose = organizationControls().children[1]; failedPurpose.value = 'later'; await failedPurpose.listeners.change();
  assert.equal(failedPurpose.value, 'reference'); assert.match(el('list-status').textContent, /Network/);
  deletionFails = false;
  failedPurpose.value = 'later'; await failedPurpose.listeners.change();
  await el('view-later').listeners.click();
  assert.equal(el('filter-type').value, '', 'switching sections clears type filters');
  const deleteButton = rowFor('Unread').children[3].children[1];
  const beforeDelete = calls.filter(c => c.type === 'DELETE_ITEM').length;
  await deleteButton.listeners.click();
  assert.equal(calls.filter(c => c.type === 'DELETE_ITEM').length, beforeDelete, 'cancel must not send delete');
  allowDisconnect = true; deletionFails = true;
  await deleteButton.listeners.click(); assert.match(el('list-status').textContent, /Delete failed/);
  assert.equal(local.items.length, 3); assert.equal(deleteButton.disabled, false);
  deletionFails = false; await deleteButton.listeners.click();
  assert.equal(local.items.length, 2); assert.equal(el('list-status').textContent, 'Deleted.');
  allowDisconnect = false;
  assert.doesNotMatch(html, /id="(?:sync|disconnect)"/);
  assert.equal(calls.some(c => c.type === 'DISCONNECT'), false);
  el('connectionUrl').value = 'https://connection.example.com/readflow/';
  assert.doesNotMatch(html, /value="google"/);
  await el('check-connection').listeners.click(); await poll();
  assert.equal(calls.findLast(c => c.type === 'VALIDATE_CONNECTION').provider, 'database');
  assert.equal(el('connectionUrl').value, 'https://connection.example.com/readflow/');
  el('connectionUrl').value = 'https://other.example.com/library/'; el('connectionUrl').listeners.input();
  assert.equal(el('export-csv').disabled, true);
  permissionGranted = false; const beforeDenied = calls.length; await el('check-connection').listeners.click();
  assert.equal(calls.length, beforeDenied); assert.match(el('auth-status').textContent, /not granted/);
  el('connectionUrl').value = 'http://example.com/'; el('connectionUrl').listeners.input(); assert.equal(el('connectionUrl').attrs['aria-invalid'], 'true');

  // Closing and reopening Settings resumes the exact pending request, even if
  // the operator approved it while this page was closed beyond ten minutes.
  viewEvents.pagehide();
  permissionGranted = true; connected = false; saved = false;
  local.connectionEndpoint = ''; local.collectionIdentity = null;
  local.pendingConnectionSetup = { endpoint: 'https://connection.example.com/readflow/', pairId, fingerprint: 'f'.repeat(64), status: 'pending', startedAt: Date.now() - 11 * 60000 };
  await import('../src/options.js?reopen'); await drain();
  assert.equal(el('connectionUrl').value, local.pendingConnectionSetup.endpoint);
  await poll(); assert.equal(saved, true); assert.equal(local.pendingConnectionSetup, undefined);
  assert.match(el('auth-status').textContent, /Connected automatically/);

  // An obsolete/replaced request cannot complete authorization automatically.
  operatorApproved = false;
  await el('check-connection').listeners.click();
  const savesBeforeExpiry = calls.filter(c => c.type === 'SAVE_SETTINGS').length;
  pairId = 'b'.repeat(36); await poll();
  assert.match(el('auth-status').textContent, /expired or changed/);
  assert.equal(calls.filter(c => c.type === 'SAVE_SETTINGS').length, savesBeforeExpiry);
  assert.equal([...timers.values()].some(timer => timer.ms === 3000), false);
  await el('check-connection').listeners.click();
  const checksBeforeChange = calls.length;
  el('connectionUrl').value = 'https://other.example.com/'; el('connectionUrl').listeners.input();
  assert.equal([...timers.values()].some(timer => timer.ms === 3000), false);
  assert.equal(calls.length, checksBeforeChange);
  viewEvents.pagehide();


});


test('setup keeps the first action visible and advanced controls collapsed', async () => {
  const html = await readFile(new URL('../src/options.html', import.meta.url), 'utf8');
  assert.match(html, /<html lang="zh-CN">/);
  const advanced = html.indexOf('id="advanced-settings"');
  const firstAction = html.indexOf('id="copy-agent-task"');
  assert.ok(firstAction < html.indexOf('id="task-preview"'));
  assert.ok(html.indexOf('id="connectionUrl"') < advanced);
  assert.ok(html.indexOf('id="copy-pair-task"') < advanced);
  assert.doesNotMatch(html, /id="save"/);
  assert.doesNotMatch(html, /<details[^>]*id="advanced-settings"[^>]*\bopen\b/);
  for (const id of ['export-csv', 'connection-meta']) {
    assert.ok(html.indexOf(`id="${id}"`) > advanced, id);
  }
});

import { normalizeCaptureMetadata, noteLength, MAX_REMARK_LENGTH } from './lib/capture-metadata.js';
import { isFolderName } from './lib/folders.js';
import { organization, inCollection, CONTENT_TYPES } from './lib/organization.js';
import { readingNote } from './lib/reading-note.js';
import { isUnread, readingStatus } from './lib/reading-state.js';
import { libraryRecordId, isLibraryDeleted } from './lib/library-binding.js';
import { initialRoute, initialView, ROUTES } from './lib/navigation.js';
import { chooseLanguage, translate, localizeError } from './lib/options-i18n.js';
import { endpointValue, requestEndpointPermission } from './lib/endpoint.js';
import { isSafeArticleUrl } from './lib/security.js';
// Unsaved edits live only in this open page, never in storage or an upload queue.
const editorDrafts = new Map();
let uiLanguage = 'zh', pairingView = null;
const t = (key, values) => translate(uiLanguage, key, values);
const errorText = error => localizeError(error, uiLanguage);
const locale = () => uiLanguage === 'zh' ? 'zh-CN' : 'en';
// The background worker serializes reading-data mutations; interface language stays local.

import {
  getItems,
  getSettings,
} from "./lib/storage.js";

// ===========================================================================
// READING LIST
// ===========================================================================

// A small inline SVG icon as an element.
function svg(paths, width = "1.8") {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("viewBox", "0 0 24 24");
  el.setAttribute("fill", "none");
  el.setAttribute("stroke", "currentColor");
  el.setAttribute("stroke-width", width);
  el.setAttribute("stroke-linecap", "round");
  el.setAttribute("stroke-linejoin", "round");
  for (const d of paths) {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d);
    el.appendChild(p);
  }
  return el;
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function savedAgo(iso) {
  const then = new Date(iso);
  return then.toLocaleDateString(locale(), { month: "short", day: "numeric" });
}

let selectedStatus = '待阅读', selectedView = initialView(globalThis.location?.hash) || 'later';
let selectedFolder = '', selectedItem = null, selectedTag = '';
const unfiled = 'unfiled';
const views = [['later', '稍后看'], ['reference', '资料夹'], ['all', '全部']];
const typeNames = { article: '文章', video: '视频', tool: '工具', web: '其他网页' };
const purposeNames = { later: '稍后看', reference: '留作资料' };
let listEmptyMessage = '';
function clearListFilters() {
  for (const id of ['filter-type', 'filter-search', 'filter-status']) element(id).value = '';
  element('filter-starred').checked = false;
  selectedStatus = '待阅读';
  selectedTag = '';
  selectedFolder = '';
  selectedItem = null;
}
const statusTabs = [['filter-unread', '待阅读', 'unread'], ['filter-read', '已读', 'read']];
function navButton(label, active, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.setAttribute('aria-pressed', String(active));
  button.addEventListener('click', onClick);
  return button;
}

function renderSidebar(items, folders) {
  const sidebar = element('library-sidebar');
  const reference = selectedView === 'reference';
  sidebar.hidden = selectedView === 'later';
  element('folder-panel').hidden = !reference;
  if (sidebar.hidden) return;
  const tagNames = [...new Set(items.flatMap(item => item.tags || []))].sort((a, b) => a.localeCompare(b, locale()));
  const selectTag = tag => () => { selectedTag = tag; selectedItem = null; return renderList(); };
  element('library-tags').replaceChildren(navButton('全部标签', !selectedTag, selectTag('')),
    ...tagNames.map(tag => navButton(tag, selectedTag === tag, selectTag(tag))));
  if (!reference) return;

  const selectFolder = id => () => { selectedFolder = id; selectedItem = null; return renderList(); };
  const tree = element('library-folders');
  const renderBranch = (id, name, parent) => {
    const branch = document.createElement('div');
    branch.className = 'folder-branch';
    branch.appendChild(navButton(name, selectedFolder === id, selectFolder(id)));
    if (selectedFolder === id && id !== '') {
      const children = items.filter(item => (item.folderId || unfiled) === id);
      for (const item of children) {
        const button = navButton(item.title || item.url, selectedItem === item.id, () => {
          selectedItem = selectedItem === item.id ? null : item.id;
          return renderList();
        });
        button.className = 'folder-item';
        branch.appendChild(button);
      }
    }
    for (const folder of folders.filter(folder => folder.parentId === id)) renderBranch(folder.id, folder.name, branch);
    parent.appendChild(branch);
  };
  tree.replaceChildren(navButton('全部资料', !selectedFolder, selectFolder('')));
  renderBranch(unfiled, '未归档', tree);
  for (const folder of folders.filter(folder => folder.parentId === null)) renderBranch(folder.id, folder.name, tree);
}

async function renderList() {
  const list = document.getElementById("list");
  const [itemsSnapshot, { knowledgeSync }] = await Promise.all([getItems(), chrome.storage.local.get('knowledgeSync')]);
  const all = itemsSnapshot.filter(item => !isLibraryDeleted(item));
  const folders = knowledgeSync?.folders || [];
  const inQueue = selectedView === 'later';
  const reference = selectedView === 'reference';
  if (selectedFolder && selectedFolder !== unfiled && !folders.some(folder => folder.id === selectedFolder)) {
    selectedFolder = '';
    selectedItem = null;
  }
  const viewItems = all.filter(item => inCollection(item, selectedView));
  const folderItems = reference && selectedFolder ? viewItems.filter(item => (item.folderId || unfiled) === selectedFolder) : viewItems;
  if (selectedTag && !folderItems.some(item => item.tags?.includes(selectedTag))) selectedTag = '';
  renderSidebar(folderItems, folders);
  element('library-workspace').setAttribute('data-view', selectedView);
  element('folder-title').hidden = !reference;
  element('folder-title').textContent = selectedFolder === unfiled ? '未归档' : folders.find(folder => folder.id === selectedFolder)?.name || '全部资料';
  const canCreateFolders = Array.isArray(knowledgeSync?.folders);
  element('folder-form').hidden = !canCreateFolders;
  element('folder-help').hidden = canCreateFolders || !knowledgeSync?.at || !!knowledgeSync.error;
  element('folder-create-label').textContent = selectedFolder && selectedFolder !== unfiled ? '新建子文件夹' : '新建文件夹';
  for (const [view, label] of views) {
    element(`view-${view}`).textContent = `${label} (${all.filter(item => inCollection(item, view) && (view !== 'later' || readingStatus(item) !== '跳过')).length})`;
    element(`view-${view}`).setAttribute('aria-pressed', String(view === selectedView));
  }
  const type = inQueue ? '' : element('filter-type').value;
  const query = inQueue ? '' : element('filter-search').value.trim().toLocaleLowerCase();
  const tag = inQueue ? '' : selectedTag;
  const starredOnly = !inQueue && element('filter-starred').checked;
  const scope = folderItems.filter(item => (!starredOnly || organization(item).starred) &&
    (!type || organization(item).contentType === type) &&
    (!tag || item.tags?.includes(tag)) && (!query || [item.title, item.url, readingNote(item)].join(' ').toLocaleLowerCase().includes(query)));
  element('collection-filters').hidden = inQueue;
  element('home-counts').hidden = !inQueue;
  element('reading-status-tabs').hidden = !inQueue;
  element('filter-status-label').hidden = selectedView !== 'all';
  const status = inQueue ? selectedStatus : reference ? '' : element('filter-status').value;
  const matches = scope.filter(item => !status || organization(item).purpose === 'later' && readingStatus(item) === status);
  if (selectedItem && !matches.some(item => item.id === selectedItem)) selectedItem = null;
  const items = selectedItem ? matches.filter(item => item.id === selectedItem) : matches;
  if (inQueue) items.sort((a, b) => (Date.parse(b.savedAt) || 0) - (Date.parse(a.savedAt) || 0));
  listEmptyMessage = type || query || tag || starredOnly || status && !inQueue ? '没有匹配的内容，请调整或清除筛选。' :
    reference ? '这里还没有资料。可以从其他文件夹移入，或将网页收藏为资料。' : '当前没有内容。打开网页后使用插件收藏，或切换阅读状态。';
  for (const [id, value, key] of statusTabs) {
    element(id).textContent = `${t(key)} (${scope.filter(item => organization(item).purpose === 'later' && readingStatus(item) === value).length})`;
    element(id).setAttribute('aria-pressed', String(selectedStatus === value));
  }
  list.replaceChildren();

  const count = document.getElementById("list-count");
  count.textContent = `共 ${items.length} 条`;

  if (items.length === 0) {
    list.appendChild(emptyState());
    return;
  }

  items.forEach((item, i) => list.appendChild(renderItem(item, i, folders)));
}

function emptyState() {
  const li = document.createElement("li");
  li.className = "empty";
  const ornament = document.createElement("div");
  ornament.className = "ornament";
  ornament.appendChild(
    svg(["M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z", "M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"], "1.4")
  );
  const h = document.createElement("p");
  h.className = "display";
  h.textContent = listEmptyMessage;
  const p = document.createElement("p");
  p.textContent = t('emptyHint');
  li.append(ornament, h, p);
  return li;
}

function renderItem(item, index, folders) {
  const li = document.createElement("li");
  li.className = "item collection-row";

  const check = document.createElement('select');
  check.className = 'status-select';
  check.setAttribute('aria-label', t('readingStatus', { title: item.title }));
  check.setAttribute('aria-describedby', 'list-status');
  for (const [, value, key] of statusTabs) {
    const option = document.createElement('option'); option.value = value; option.textContent = t(key); check.appendChild(option);
  }
  if (readingStatus(item) === '跳过') {
    const previous = document.createElement('option');
    previous.value = '跳过'; previous.textContent = '已跳过'; previous.disabled = true;
    check.appendChild(previous);
  }
  check.value = readingStatus(item);
  check.hidden = organization(item).purpose === 'reference';
  check.addEventListener('change', async () => {
    const status = check.value; check.disabled = true;
    document.getElementById('list-status').textContent = '';
    try { await mutate({ type: 'SET_STATUS', id: item.id, status }); await renderList(); await renderHome(); }
    catch (error) { check.value = readingStatus(item); document.getElementById('list-status').textContent = errorText(error); }
    finally { check.disabled = false; }
  });

  // Title + meta. Clicking the title opens the article in a new tab.
  const body = document.createElement("div");
  body.className = "item-body";

  const linked = isSafeArticleUrl(item.url);
  const title = document.createElement(linked ? "a" : "span");
  title.className = "item-title";
  title.textContent = item.title?.trim() || item.url || t('untitled');
  if (linked) title.href = item.url;
  if (linked) { title.target = "_blank"; title.rel = "noreferrer"; }

  const fields = organization(item);
  const meta = document.createElement("div");
  meta.className = "item-meta";
  const bits = [t('itemMeta', { domain: domainOf(item.url), date: savedAgo(item.savedAt) })];
  if (selectedView !== 'later') bits.push(typeNames[fields.contentType]);
  if (selectedView === 'all') bits.push(purposeNames[fields.purpose]);
  if (Number.isFinite(item.readAt)) bits.push(`标记已读 ${new Date(item.readAt).toLocaleString(locale())}`);
  meta.append(document.createTextNode(bits.join(' · ')));

  body.append(title, meta);
  const controls = document.createElement('div'); controls.className = 'item-organization';
  async function update(control, metadata, confirmed = () => {}) {
    control.disabled = true; element('list-status').textContent = '正在保存…';
    try {
      await mutate({ type: 'UPDATE_METADATA', id: item.id, metadata });
      confirmed();
      await renderList(); await renderHome();
      if (Object.hasOwn(metadata, 'purpose')) {
        element('list-status').textContent = metadata.purpose === 'reference' ? '已移到资料夹' : '已加入稍后看';
      } else if (Object.hasOwn(metadata, 'folderId')) {
        element('list-status').textContent = metadata.folderId ? '已移到所选文件夹' : '已移到未归档';
      } else if (Object.hasOwn(metadata, 'starred')) {
        element('list-status').textContent = metadata.starred ? '已添加星标' : '已取消星标';
      } else {
        element('list-status').textContent = '修改已保存到数据库';
      }
    } catch (error) {
      if (control === star) control.setAttribute('aria-pressed', String(fields.starred));
      else if (Object.hasOwn(metadata, 'purpose') || Object.hasOwn(metadata, 'contentType')) control.value = fields[Object.keys(metadata)[0]];
      else if (Object.hasOwn(metadata, 'folderId')) control.value = item.folderId || '';
      element('list-status').textContent = errorText(error);
      return false;
    } finally { control.disabled = false; }
  }
  const star = document.createElement('button'); star.type = 'button';
  star.textContent = fields.starred ? '★ 已星标' : '☆ 星标'; star.setAttribute('aria-pressed', String(fields.starred));
  star.setAttribute('aria-label', `${fields.starred ? '取消星标' : '添加星标'}：${item.title || item.url}`);
  star.addEventListener('click', () => update(star, { starred: !fields.starred }));
  controls.appendChild(star);
  const choicesByField = [['purpose', '收藏用途', [['later', '稍后看'], ['reference', '留作资料']]]];
  if (selectedView !== 'later') choicesByField.push(['contentType', '内容类型', CONTENT_TYPES.map(type => [type, typeNames[type]])]);
  for (const [key, label, choices] of choicesByField) {
    const select = document.createElement('select'); select.setAttribute('aria-label', `${label}：${item.title || item.url}`);
    for (const [value, text] of choices) { const option = document.createElement('option'); option.value = value; option.textContent = text; select.appendChild(option); }
    select.value = fields[key]; select.addEventListener('change', () => update(select, { [key]: select.value })); controls.appendChild(select);
  }
  if (fields.purpose === 'reference' && folders.length) {
    const folderSelect = document.createElement('select');
    folderSelect.setAttribute('aria-label', `移动到文件夹：${item.title || item.url}`);
    const paths = new Map();
    for (const [id, name, parentId] of [['', '未归档', null], ...folders.map(folder => [folder.id, folder.name, folder.parentId])]) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = parentId ? `${paths.get(parentId)} / ${name}` : name;
      paths.set(id, option.textContent);
      folderSelect.appendChild(option);
    }
    folderSelect.value = item.folderId || '';
    folderSelect.addEventListener('change', () => update(folderSelect, { folderId: folderSelect.value || null }));
    controls.appendChild(folderSelect);
  }
  body.appendChild(controls);
  const tags = document.createElement('div'); tags.className = 'collection-tags';
  for (const value of item.tags || []) {
    const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = value; tags.appendChild(tag);
  }
  if (!item.tags?.length) tags.textContent = t('noTags');
  function textEditor(key, original, label, parse) {
    const draftKey = `${item.id}:${key}`;
    const editor = document.createElement('div'); editor.className = 'inline-editor';
    const grow = document.createElement('div'); grow.className = 'growing-text';
    const input = document.createElement('textarea'); input.rows = 1;
    input.value = editorDrafts.get(draftKey) ?? original;
    input.setAttribute('aria-label', `${label}：${item.title || item.url}`);
    const mirror = document.createElement('div'); mirror.className = 'text-mirror'; mirror.setAttribute('aria-hidden', 'true');
    const hint = document.createElement('p'); hint.className = 'field-hint'; hint.id = `editor-${index}-${key}`;
    input.setAttribute('aria-describedby', hint.id);
    const save = document.createElement('button'); save.type = 'button'; save.textContent = `保存${label}`;
    const feedback = document.createElement('p'); feedback.className = 'field-hint'; feedback.setAttribute('role', 'status');
    function refresh() {
      mirror.textContent = input.value + '\n';
      const over = key === 'remark' && noteLength(input.value) > MAX_REMARK_LENGTH;
      hint.textContent = key === 'remark' ? `${noteLength(input.value)} / 140 字${over && input.value === original ? ' · 旧笔记完整保留，修改后需不超过 140 字' : ''}` : '每行一个标签，每个最多 50 字；留空并保存可清除标签。';
      input.setAttribute('aria-invalid', String(over && input.value !== original));
      save.disabled = input.value === original || over;
    }
    input.addEventListener('input', () => {
      if (input.value === original) editorDrafts.delete(draftKey); else editorDrafts.set(draftKey, input.value);
      feedback.textContent = '尚未保存'; refresh();
    });
    save.addEventListener('click', async () => {
      if (save.disabled) return;
      let metadata;
      try { metadata = normalizeCaptureMetadata({ [key]: parse(input.value) }); }
      catch (error) { input.setAttribute('aria-invalid', 'true'); feedback.textContent = errorText(error); return; }
      input.disabled = true; feedback.textContent = '正在保存…';
      const result = await update(save, metadata, () => editorDrafts.delete(draftKey));
      input.disabled = false;
      if (result === false) { feedback.textContent = '保存失败，输入仍保留。请点击保存重试；关闭页面会丢失未保存内容。'; refresh(); }
    });
    grow.append(input, mirror); editor.append(grow, hint, save, feedback); refresh();
    return editor;
  }
  tags.appendChild(textEditor('tags', (item.tags || []).join('\n'), '标签', value => value.split(/\r?\n/).map(tag => tag.trim()).filter(Boolean)));
  const note = textEditor('remark', readingNote(item), '笔记', value => value);
  note.className = 'collection-note inline-editor';


  // Delete button.
  const del = document.createElement("button");
  del.className = "del";
  del.title = t('remove');
  del.setAttribute('aria-label', del.title);
  del.appendChild(svg(["M18 6L6 18", "M6 6l12 12"], "2"));
  del.addEventListener("click", async () => {
    if (!globalThis.confirm(t(libraryRecordId(item) ? 'deleteConfirm' : 'deleteLocalConfirm', { title: item.title || item.url }))) return;
    del.disabled = true;
    element('list-status').textContent = t('deleting');
    try { await mutate({ type: 'DELETE_ITEM', id: item.id }); editorDrafts.delete(`${item.id}:remark`); editorDrafts.delete(`${item.id}:tags`); await renderList(); await renderHome(); element('list-status').textContent = t('deleted'); }
    catch (error) { del.disabled = false; element('list-status').textContent = t('deleteFailed', { reason: errorText(error) }); }
  });

  li.append(body, tags, note, check, del);
  return li;
}

// ===========================================================================
// SETTINGS
// ===========================================================================

async function mutate(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.ok) throw new Error(result?.error || t('genericFailure'));
  return result;
}
let connection = null, pairingState = { approved: false }, validationSequence = 0, checkingConnection = false;
let authError = null;
const element = id => document.getElementById(id);
let currentRoute = 'settings';
let configuredLibrary = false, busyAction = null;
function applyRoute(route) {
  currentRoute = ROUTES.includes(route) ? route : 'settings';
  for (const view of ROUTES) element(view).hidden = view !== currentRoute;
  for (const [id, view] of [['nav-collection', 'reading-list'], ['nav-settings', 'settings']]) {
    if (view === currentRoute) element(id).setAttribute('aria-current', 'page'); else element(id).removeAttribute('aria-current');
  }
  document.title = `ReadFlow · ${t(currentRoute === 'reading-list' ? 'collection' : currentRoute)}`;
}
async function renderHome() {
  const items = (await getItems()).filter(item => !isLibraryDeleted(item) && organization(item).purpose === 'later');
  element('home-counts').textContent = t('homeCounts', { unread: items.filter(isUnread).length, read: items.filter(item => readingStatus(item) === '已读').length });
  element('collection-setup').hidden = configuredLibrary;
  element('home-status').textContent = t(connection?.connected && pairingState.approved ? 'homeReady' : 'homeNeedsSetup');
}
function fillSettings(settings) {
  element('connectionUrl').value = settings.connectionUrl ?? '';
}
function updateExportButton() {
  const endpoint = addressFeedback();
  const ready = !!endpoint && endpoint === pairingState.baseUrl && !checkingConnection && connection?.connected && pairingState.approved;
  element('export-csv').disabled = !ready || !!busyAction;
}
function renderPairingStatus() {
  let visibleEndpoint = '';
  try { visibleEndpoint = endpointValue(element('connectionUrl').value); } catch {}
  const pair = pairingView || (visibleEndpoint === pairingState.baseUrl ? pairingState : { status: 'unpaired' });
  element('pair-status').textContent = t(pair.approved || pair.status === 'approved' ? 'pairApproved' : pair.status === 'pending' ? 'pairPending' : 'pairUnpaired');
  element('pair-fingerprint').textContent = pair.fingerprint ? t('pairFingerprint', { fingerprint: pair.fingerprint }) : '';
  element('pair-details').hidden = !pair.fingerprint;
  element('copy-pair-task').disabled = !pair.fingerprint || !!busyAction;
  element('pair-task').value = pair.fingerprint ? t('pairTask', { endpoint: visibleEndpoint, extensionId: chrome.runtime.id || '', pairId: pair.pairId, fingerprint: pair.fingerprint }) : '';
}
async function refreshPairingStatus() {
  const pair = await mutate({ type: 'PAIR_STATUS' });
  pairingState = pair; pairingView = null; renderPairingStatus();
}
function addressFeedback() {
  element('connectionUrl').removeAttribute('aria-invalid');
  try { const target = endpointValue(element('connectionUrl').value); element('endpoint-error').textContent = ''; return target; }
  catch (error) { element('connectionUrl').setAttribute('aria-invalid', 'true'); element('endpoint-error').textContent = errorText(error); return null; }
}
function collectSettings() {
  const connectionUrl = addressFeedback();
  if (connectionUrl === null) { element('connectionUrl').focus(); throw new Error(element('endpoint-error').textContent); }

  return { connectionUrl, provider: 'database', language: uiLanguage };
}
let refreshing = null;
async function showSyncStatus() {
  const { knowledgeSync } = await chrome.storage.local.get('knowledgeSync');
  if (!configuredLibrary || refreshing) return;
  const failed = !!knowledgeSync?.error;
  element('refresh-status').textContent = failed ? '无法连接资料库，当前显示上次获取的内容。' : '';
  element('retry-refresh').hidden = !failed;
}
async function refreshLibrary() {
  if (!configuredLibrary) return;
  if (refreshing) return refreshing;
  element('refresh-status').textContent = '正在获取最新资料…';
  element('retry-refresh').disabled = true;
  refreshing = (async () => {
    try {
      await mutate({ type: 'SYNC' });
      await renderList(); await renderHome();
      element('refresh-status').textContent = '资料已更新';
      element('retry-refresh').hidden = true;
    } catch (error) {
      element('refresh-status').textContent = '无法连接资料库，当前显示上次获取的内容。' + errorText(error);
      element('retry-refresh').hidden = false;
    } finally { element('retry-refresh').disabled = false; }
  })();
  try { await refreshing; } finally { refreshing = null; }
}
function renderConnection(status) {
  connection = status;
  element('setup-guide').hidden = configuredLibrary;
  element('pair-help').hidden = configuredLibrary;
  element('auth-status').setAttribute('data-state', authError ? 'error' : status?.connected ? 'success' : 'info');
  element('auth-status').textContent = authError ? errorText(authError) : t(checkingConnection ? 'checking' : pairingView?.status === 'pending' ? 'pairWaiting' : status?.connected ? configuredLibrary ? 'connected' : 'connectedUnsaved' : configuredLibrary ? 'configuredOffline' : 'disconnected');
  element('connection-meta').textContent = t('footer', { server: pairingState.baseUrl || t('offline'), version: chrome.runtime.getManifest().version, extensionId: chrome.runtime.id || t('unverified'), protocol: status?.protocolVersion || t('unverified') });
  updateExportButton();
  renderHome().catch(() => { element('home-status').textContent = t('genericFailure'); });
}
function translatePage() {
  document.documentElement.lang = uiLanguage;
  element('ui-language').value = uiLanguage;
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.getAttribute('data-i18n'));
  for (const node of document.querySelectorAll('[data-i18n-placeholder]')) node.setAttribute('placeholder', t(node.getAttribute('data-i18n-placeholder')));
  element('agent-task').value = t('agentTask', { extensionId: chrome.runtime.id || t('unverified') });
  applyRoute(currentRoute);
}
async function showConnection({ verifyOnly = false, authorize = false } = {}) {
  const sequence = ++validationSequence;
  authError = null; checkingConnection = true;
  element('auth-status').textContent = t('checking');
  updateExportButton();
  try {
    const connectionUrl = endpointValue(element('connectionUrl').value);
    if (authorize && !await requestEndpointPermission(connectionUrl)) throw new Error(t('permissionDenied'));
    if (sequence !== validationSequence) return;
    if (authorize) {
      const pair = await mutate({ type: 'PAIR_REQUEST', connectionUrl });
      if (sequence !== validationSequence) return;
      pairingView = pair; renderPairingStatus();
      if (pair.status !== 'approved') { checkingConnection = false; renderConnection(null); throw new Error(t('pairWaiting')); }
    }
    const linkPayload = {};
    const status = await mutate(verifyOnly ? { type: 'VALIDATE_CONNECTION', provider: 'database', connectionUrl, ...linkPayload } : { type: 'CONNECTION_STATUS', provider: 'database', connectionUrl, ...linkPayload });
    if (sequence !== validationSequence) return;
    checkingConnection = false; renderConnection(status);
    renderPairingStatus();

  } catch (error) {
    if (sequence !== validationSequence) return;
    checkingConnection = false; authError = error.message;
    if (error.message.includes('PAIR_REQUIRED')) pairingState.approved = false;
    renderConnection(null); renderPairingStatus();
    throw error;
  }
}
let approvalTimer = null, approvalGeneration = 0;
function stopApprovalWatch() {
  approvalGeneration++;
  clearTimeout(approvalTimer);
  approvalTimer = null;
}
function watchApproval(endpoint, expectedPair, startedAt = Date.now()) {
  stopApprovalWatch();
  const generation = approvalGeneration;
  const current = () => generation === approvalGeneration && addressFeedback() === endpoint;
  async function checkApproval() {
    if (!current()) return;
    if (busyAction) { approvalTimer = setTimeout(checkApproval, 3000); return; }
    let finalizing = false;
    try {
      const pair = await mutate({ type: 'PAIR_REQUEST', connectionUrl: endpoint });
      if (!current()) return;
      if (pair.pairId !== expectedPair.pairId || pair.fingerprint !== expectedPair.fingerprint || pair.status !== 'approved' && Date.now() - startedAt >= 10 * 60 * 1000) {
        element('auth-status').textContent = t('pairExpired');
        element('auth-status').setAttribute('data-state', 'error');
        return;
      }
      pairingView = pair; authError = null; renderPairingStatus();
      if (pair.status !== 'approved') {
        element('auth-status').textContent = t('pairWaiting');
        element('auth-status').setAttribute('data-state', 'info');
      } else {
        finalizing = true; busyAction = 'auto-connect';
        for (const id of ['connectionUrl', 'check-connection', 'copy-pair-task']) element(id).disabled = true;
        element('auth-status').textContent = t('pairVerifying');
        element('auth-status').setAttribute('data-state', 'info');
        updateExportButton();
        const status = await mutate({ type: 'VALIDATE_CONNECTION', provider: 'database', connectionUrl: endpoint });
        if (!current()) return;
        if (!status.connected) throw new Error(t('genericFailure'));
        const result = await mutate({ type: 'SAVE_SETTINGS', settings: { connectionUrl: endpoint, provider: 'database', language: uiLanguage } });
        if (!current()) return;
        configuredLibrary = true; fillSettings(result.settings);
        await refreshPairingStatus(); renderConnection(status); flashSaved();
        element('auth-status').textContent = t('pairComplete');
        element('auth-status').setAttribute('data-state', 'success');
        await refreshLibrary();
        stopApprovalWatch();
        return;
      }
    } catch (error) {
      if (!current()) return;
      if (Date.now() - startedAt >= 10 * 60 * 1000) { element('auth-status').textContent = t('pairExpired'); element('auth-status').setAttribute('data-state', 'error'); return; }
      element('auth-status').textContent = t('pairRetry', { reason: errorText(error) });
      element('auth-status').setAttribute('data-state', 'error');
    } finally {
      if (finalizing) {
        busyAction = null;
        element('connectionUrl').disabled = false;
        element('check-connection').disabled = false;
        updateExportButton(); renderPairingStatus();
      }
    }
    if (current()) approvalTimer = setTimeout(checkApproval, 3000);
  }
  approvalTimer = setTimeout(checkApproval, expectedPair.status === 'approved' ? 0 : 3000);
}
globalThis.addEventListener?.('pagehide', stopApprovalWatch);

function bindAction(id, action) {
  const button = element(id);
  button.addEventListener('click', async () => {
    if (busyAction) return;
    busyAction = id;
    const controls = ['check-connection', 'copy-pair-task', 'connectionUrl', 'export-csv'];
    const previous = controls.map(name => [name, element(name).disabled]);
    for (const name of controls) element(name).disabled = true;
    const feedback = id.startsWith('export-') ? 'export-status' : 'auth-status';
    element(feedback).textContent = ''; element(feedback).removeAttribute('data-state');
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    updateExportButton();
    try { await action(); }
    catch (error) { element(feedback).textContent = errorText(error); element(feedback).setAttribute('data-state', 'error'); }
    finally {
      busyAction = null;
      for (const [name, disabled] of previous) element(name).disabled = disabled;
      button.removeAttribute('aria-busy'); updateExportButton(); renderPairingStatus();
    }
  });
}
function flashSaved() {
  const note = document.getElementById("saved-note");
  note.classList.add("show");
  setTimeout(() => note.classList.remove("show"), 1800);
}

// ===========================================================================
// STARTUP
// ===========================================================================

async function init() {
  const { uiLanguage: savedLanguage } = await chrome.storage.local.get('uiLanguage');
  uiLanguage = chooseLanguage(savedLanguage);
  translatePage();
  for (const [view] of views) element(`view-${view}`).addEventListener('click', async () => {
    selectedView = view; clearListFilters();
    if (location.hash.startsWith('#reading-list')) history.replaceState(null, '', '#reading-list/' + view);
    await renderList();
  });
  for (const id of ['filter-type', 'filter-status']) element(id).addEventListener('change', renderList);
  element('folder-form').addEventListener('submit', async event => {
    event.preventDefault();
    const input = element('folder-name'), button = element('create-folder'), feedback = element('folder-status');
    if (button.disabled) return;
    const name = input.value.trim();
    if (!isFolderName(name)) {
      input.setAttribute('aria-invalid', 'true');
      feedback.textContent = '请输入 1 到 80 字的文件夹名称。';
      return;
    }
    input.removeAttribute('aria-invalid');
    const parentId = selectedFolder && selectedFolder !== unfiled ? selectedFolder : null;
    button.disabled = true; input.disabled = true;
    try {
      const result = await mutate({ type: 'CREATE_FOLDER', name, parentId });
      selectedFolder = result.folderId;
      selectedItem = null; selectedTag = '';
      input.value = '';
      feedback.textContent = '文件夹已建立。';
      await renderList();
    } catch (error) { feedback.textContent = errorText(error); }
    finally { button.disabled = false; input.disabled = false; }
  });
  element('filter-starred').addEventListener('change', renderList);
  element('filter-search').addEventListener('input', renderList);
  element('clear-filters').addEventListener('click', async () => {
    const folder = selectedFolder;
    clearListFilters();
    selectedFolder = folder;
    await renderList();
  });
  for (const [id, value] of statusTabs) element(id).addEventListener('click', async () => { selectedStatus = value; await renderList(); });
  applyRoute(initialRoute(location.hash));
  globalThis.addEventListener?.('hashchange', async () => {
    applyRoute(initialRoute(location.hash));
    const view = initialView(location.hash);
    if (view && view !== selectedView) { selectedView = view; clearListFilters(); await renderList(); }
    if (currentRoute === 'reading-list') await refreshLibrary();
  });
  globalThis.addEventListener?.('focus', () => { if (currentRoute === 'reading-list') return refreshLibrary(); });
  element('retry-refresh').addEventListener('click', refreshLibrary);
  await renderList();
  await showSyncStatus();
  fillSettings(await getSettings());

  element('copy-agent-task').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(element('agent-task').value); element('copy-agent-status').textContent = t('taskCopied'); }
    catch { element('task-preview').open = true; element('agent-task').focus(); element('agent-task').select(); element('copy-agent-status').textContent = t('taskCopyFallback'); }
  });
  element('copy-pair-task').addEventListener('click', async () => {
    if (!element('pair-task').value) return;
    try { await navigator.clipboard.writeText(element('pair-task').value); element('copy-pair-status').textContent = t('taskCopied'); }
    catch { element('pair-task-preview').open = true; element('pair-task').focus(); element('pair-task').select(); element('copy-pair-status').textContent = t('taskCopyFallback'); }
  });
  await refreshPairingStatus();
  const savedLibrary = await chrome.storage.local.get(['collectionIdentity', 'connectionEndpoint']);
  configuredLibrary = !!(savedLibrary.collectionIdentity && savedLibrary.connectionEndpoint);
  renderConnection(null);
  element('connectionUrl').addEventListener('input', () => { stopApprovalWatch(); validationSequence++; checkingConnection = false; connection = null; pairingView = null; authError = null; renderConnection(null); renderPairingStatus(); addressFeedback(); });
  element('ui-language').addEventListener('change', async () => {
    uiLanguage = chooseLanguage(element('ui-language').value);
    await chrome.storage.local.set({ uiLanguage });
    translatePage(); renderPairingStatus(); renderConnection(connection);
    await renderList(); await renderHome(); await showSyncStatus();
  });
  async function exportLibrary() {
    element('export-status').textContent = t('exportWorking');
    try {
      await mutate({ type: 'SYNC' });
      const result = await mutate({ type: 'EXPORT_CSV' });
      {
        if (typeof result.csv !== 'string') throw new Error(t('genericFailure'));
        const url = URL.createObjectURL(new Blob([result.csv], { type: 'text/csv;charset=utf-8' }));
        const link = document.createElement('a'); link.href = url; link.download = 'readflow.csv'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      element('export-status').textContent = t('csvDone');
    } catch (error) { element('export-status').textContent = errorText(error); }
  }
  bindAction('export-csv', exportLibrary);
  bindAction('check-connection', async () => {
    const connectionUrl = addressFeedback();
    if (!connectionUrl) return;
    stopApprovalWatch();
    const sequence = ++validationSequence;
    if (!await requestEndpointPermission(connectionUrl)) throw new Error(t('permissionDenied'));
    const pair = await mutate({ type: 'PAIR_REQUEST', connectionUrl });
    if (sequence !== validationSequence) return;
    pairingView = pair; authError = null; renderPairingStatus(); renderConnection(null);
    element('auth-status').textContent = t(pair.status === 'approved' ? 'pairVerifying' : 'pairWaiting');
    watchApproval(connectionUrl, pair);
  });
  const { pendingConnectionSetup } = await chrome.storage.local.get('pendingConnectionSetup');
  if (pendingConnectionSetup?.endpoint && pendingConnectionSetup.pairId) {
    fillSettings({ connectionUrl: pendingConnectionSetup.endpoint });
    pairingView = pendingConnectionSetup; renderPairingStatus();
    watchApproval(pendingConnectionSetup.endpoint, pendingConnectionSetup, pendingConnectionSetup.startedAt);
  } else if (pairingState.approved) { try { await showConnection(); } catch { /* failure is shown next to the action */ } }

  const configured = configuredLibrary;
  applyRoute(initialRoute(location.hash, configured));
  await renderHome(); await renderList();
  if (currentRoute === 'reading-list') await refreshLibrary();

  // Keep the list fresh if a save happens (from the toolbar icon) while this
  // tab is open.
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.items) { renderList(); renderHome(); }
    if (changes.knowledgeSync) { showSyncStatus(); renderList(); }
  });
}

init();

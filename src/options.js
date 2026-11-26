import { normalizeCaptureMetadata, noteLength, MAX_REMARK_LENGTH } from './lib/capture-metadata.js';
import { isFolderName } from './lib/folders.js';
import { organization, inCollection, CONTENT_TYPES } from './lib/organization.js';
import { readingNote } from './lib/reading-note.js';
import { libraryRecordId, isLibraryDeleted } from './lib/library-binding.js';
import { parseHash, ROUTES } from './lib/navigation.js';
import { chooseLanguage, translate, localizeError } from './lib/options-i18n.js';
import { endpointValue, requestEndpointPermission } from './lib/endpoint.js';
import { isSafeArticleUrl } from './lib/security.js';
import { displayPairingFingerprint } from './lib/pairing-fingerprint.js';
let uiLanguage = 'zh', pairingView = null;
const t = (key, values) => translate(uiLanguage, key, values);
const errorText = error => error?.diagnostic?.code === 'EXTENSION_ID_UNSET'
  ? t('extensionIdUnset', { extensionId: chrome.runtime.id }) : localizeError(error, uiLanguage);
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

let selectedView = parseHash(globalThis.location?.hash).view || 'later';
let selectedFolder = '', selectedItem = null, selectedTag = '';
const expandedFolders = new Set();
const unfiled = 'unfiled';
const views = [['later', 'viewLater'], ['reference', 'viewReference']];
const typeNames = { article: '文章', video: '视频', tool: '工具', web: '其他网页' };
const collectionHash = view => `#reading-list/${view}`;
const folderIcon = 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z';
const recordIcon = ['M6 3h8l4 4v14H6z M14 3v5h4', 'M9 12h6m-6 4h6'];
const chevronIcon = ['M9 6l6 6-6 6'];
let listEmptyMessage = '';
function clearListFilters() {
  for (const id of ['filter-type', 'filter-search']) element(id).value = '';
  element('filter-starred').checked = false;
  selectedTag = '';
  selectedFolder = '';
  selectedItem = null;
  closeFolderForm(false);
  setFolderPickerOpen(false);
}
function navButton(label, active, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.setAttribute('aria-pressed', String(active));
  button.addEventListener('click', onClick);
  return button;
}

function setFolderPickerOpen(open, restoreFocus = false) {
  const picker = element('folder-picker');
  picker.setAttribute('aria-expanded', String(open));
  if (restoreFocus) picker.focus();
}

function folderPickerIsOpen() {
  const picker = element('folder-picker');
  return picker.getAttribute('aria-expanded') === 'true' && picker.getClientRects?.().length > 0;
}

async function selectFromTree(folderId, itemId, buttonId) {
  const returnToPicker = folderPickerIsOpen();
  if (itemId !== null) clearListFilters();
  else if (selectedFolder !== folderId) closeFolderForm(false);
  selectedFolder = folderId;
  selectedItem = itemId;
  setFolderPickerOpen(false, returnToPicker);
  await renderList();
  if (!returnToPicker) element(buttonId)?.focus();
}

function groupByFolder(entries, getFolderId) {
  const groups = new Map();
  for (const entry of entries) {
    const id = getFolderId(entry);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(entry);
  }
  return groups;
}

function renderSidebar(items, folders, folderItems) {
  const sidebar = element('library-sidebar');
  sidebar.hidden = selectedView !== 'reference';
  if (sidebar.hidden) return;
  const tagNames = [...new Set(folderItems.flatMap(item => item.tags || []))].sort((a, b) => a.localeCompare(b, locale()));
  const selectTag = tag => () => { selectedTag = tag; selectedItem = null; return renderList(); };
  element('library-tags').replaceChildren(navButton('全部标签', !selectedTag, selectTag('')),
    ...tagNames.map(tag => navButton(tag, selectedTag === tag, selectTag(tag))));

  const foldersByParent = groupByFolder(folders, folder => folder.parentId);
  const itemsByFolder = groupByFolder(items, item => item.folderId || unfiled);
  const directory = element('library-folders');
  const focusedId = directory.contains?.(document.activeElement) ? document.activeElement.id : '';
  const tree = document.createElement('ul');
  tree.className = 'folder-tree';
  function choice(label, folderId, itemId = null) {
    const buttonId = itemId === null ? `folder-choice-${folderId}` : `folder-record-${itemId}`;
    const active = itemId === null ? selectedFolder === folderId : selectedItem === itemId;
    const button = navButton('', active, () => selectFromTree(folderId, itemId, buttonId));
    button.id = buttonId;
    button.className = 'folder-choice';
    const name = document.createElement('span');
    name.textContent = label;
    button.replaceChildren(svg(itemId === null ? [folderIcon] : recordIcon), name);
    return button;
  }
  function renderBranch(id, name, parent, depth) {
    const branch = document.createElement('li');
    branch.className = 'folder-branch';
    const row = document.createElement('div');
    row.className = 'folder-branch-row';
    row.style.paddingInlineStart = `${Math.min(depth, 4) * 9}px`;
    branch.appendChild(row);
    const subfolders = foldersByParent.get(id) || [];
    const records = itemsByFolder.get(id) || [];
    if (subfolders.length || records.length) {
      const children = document.createElement('ul');
      children.id = `folder-children-${id}`;
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.id = `folder-toggle-${id}`;
      toggle.className = 'folder-toggle';
      toggle.setAttribute('aria-controls', children.id);
      toggle.appendChild(svg(chevronIcon));
      function showChildren(open) {
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', t(open ? 'folderCollapse' : 'folderExpand', { name }));
        children.hidden = !open;
        if (!open || children.children.length) return;
        for (const folder of subfolders) renderBranch(folder.id, folder.name, children, depth + 1);
        for (const item of records) {
          const entry = document.createElement('li');
          entry.className = 'folder-record';
          entry.style.paddingInlineStart = `${26 + Math.min(depth + 1, 4) * 9}px`;
          entry.appendChild(choice(item.title || item.url, id, item.id));
          children.appendChild(entry);
        }
      }
      toggle.addEventListener('click', () => {
        const open = !expandedFolders.has(id);
        if (open) expandedFolders.add(id); else expandedFolders.delete(id);
        showChildren(open);
      });
      row.appendChild(toggle);
      branch.appendChild(children);
      showChildren(expandedFolders.has(id));
    }
    row.appendChild(choice(name, id));
    parent.appendChild(branch);
  }
  renderBranch('', t('folderOverview'), tree, 0);
  renderBranch(unfiled, t('folderUnfiled'), tree, 0);
  for (const folder of foldersByParent.get(null) || []) renderBranch(folder.id, folder.name, tree, 0);
  directory.replaceChildren(tree);
  if (focusedId) element(focusedId)?.focus();
}

async function renderList() {
  const list = document.getElementById("list");
  const [itemsSnapshot, { knowledgeSync }] = await Promise.all([getItems(), chrome.storage.local.get('knowledgeSync')]);
  const all = itemsSnapshot.filter(item => !isLibraryDeleted(item));
  const folders = knowledgeSync?.folders || [];
  const reference = selectedView === 'reference';
  if (selectedFolder && selectedFolder !== unfiled && !folders.some(folder => folder.id === selectedFolder)) {
    selectedFolder = '';
    selectedItem = null;
  }
  const viewItems = all.filter(item => inCollection(item, selectedView));
  const folderItems = reference && selectedFolder ? viewItems.filter(item => (item.folderId || unfiled) === selectedFolder) : viewItems;
  if (selectedTag && !folderItems.some(item => item.tags?.includes(selectedTag))) selectedTag = '';
  element('library-workspace').setAttribute('data-view', selectedView);
  element('folder-title').hidden = !reference;
  const folderName = selectedFolder === unfiled ? t('folderUnfiled') : folders.find(folder => folder.id === selectedFolder)?.name || t('folderOverview');
  element('folder-title').textContent = folderName;
  element('folder-picker-name').textContent = folderName;
  element('folder-picker').hidden = !reference;
  const canCreateFolders = Array.isArray(knowledgeSync?.folders);
  const folderAction = t(selectedFolder && selectedFolder !== unfiled ? 'folderAddChild' : 'folderAdd');
  const folderButton = element('open-folder-form');
  folderButton.disabled = !reference || !canCreateFolders || element('create-folder').disabled;
  folderButton.title = folderAction;
  folderButton.setAttribute('aria-label', folderAction);
  if (!reference || !canCreateFolders) closeFolderForm(false);
  element('folder-help').hidden = canCreateFolders || !knowledgeSync?.at || !!knowledgeSync.error;
  element('folder-create-label').textContent = folderAction;
  for (const [view, label] of views) {
    element(`view-${view}`).textContent = `${t(label)} (${all.filter(item => inCollection(item, view)).length})`;
    element(`view-${view}`).setAttribute('aria-pressed', String(view === selectedView));
  }
  const type = reference ? element('filter-type').value : '';
  const query = reference ? element('filter-search').value.trim().toLocaleLowerCase() : '';
  const tag = reference ? selectedTag : '';
  const starredOnly = reference && element('filter-starred').checked;
  const matches = folderItems.filter(item => (!starredOnly || organization(item).starred) &&
    (!type || organization(item).contentType === type) &&
    (!tag || item.tags?.includes(tag)) && (!query || [item.title, item.url, readingNote(item)].join(' ').toLocaleLowerCase().includes(query)));
  element('collection-filters').hidden = !reference;
  if (selectedItem && !matches.some(item => item.id === selectedItem)) selectedItem = null;
  renderSidebar(viewItems, folders, folderItems);
  const items = selectedItem ? matches.filter(item => item.id === selectedItem) : matches;
  if (!reference) items.sort((a, b) => (Date.parse(b.savedAt) || 0) - (Date.parse(a.savedAt) || 0));
  listEmptyMessage = t(type || query || tag || starredOnly ? 'emptyFilters' : reference ? 'emptyFolders' : 'emptyLater');
  list.replaceChildren();

  const count = document.getElementById("list-count");
  count.textContent = t('listCount', { count: items.length });

  if (items.length === 0) {
    list.appendChild(emptyState());
    return;
  }

  for (const item of items) list.appendChild(renderItem(item, folders));
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
  li.append(ornament, h);
  return li;
}

function closeFolderForm(focus) {
  element('folder-form').hidden = true;
  element('open-folder-form').setAttribute('aria-expanded', 'false');
  const name = element('folder-name');
  name.value = '';
  name.removeAttribute('aria-invalid');
  if (focus) element('open-folder-form').focus();
}

function renderItem(item, folders) {
  const li = document.createElement("li");
  li.className = "item collection-row";

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
  meta.append(document.createTextNode(bits.join(' · ')));

  body.append(title, meta);
  const controls = document.createElement('div'); controls.className = 'item-organization';
  async function update(control, metadata) {
    control.disabled = true; element('list-status').textContent = '正在保存…';
    try {
      await mutate({ type: 'UPDATE_METADATA', id: item.id, metadata });
      await renderList();
      if (Object.hasOwn(metadata, 'purpose')) {
        element('list-status').textContent = metadata.purpose === 'reference' ? '已移到文件夹' : '已加入稍后看';
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
  const note = document.createElement('p');
  note.className = 'collection-note';
  note.textContent = readingNote(item);
  const actions = document.createElement('div');
  actions.className = 'item-actions';
  const edit = document.createElement('a');
  edit.className = 'item-edit';
  edit.href = `${collectionHash(selectedView)}/edit/${encodeURIComponent(item.id)}`;
  edit.textContent = t('editLink');
  edit.setAttribute('aria-label', t('editLinkLabel', { title: title.textContent }));

  const del = document.createElement("button");
  del.type = 'button';
  del.className = "del";
  del.title = t('remove');
  del.setAttribute('aria-label', del.title);
  del.appendChild(svg(["M18 6L6 18", "M6 6l12 12"], "2"));
  del.addEventListener("click", async () => {
    if (!globalThis.confirm(t(libraryRecordId(item) ? 'deleteConfirm' : 'deleteLocalConfirm', { title: item.title || item.url }))) return;
    del.disabled = true;
    element('list-status').textContent = t('deleting');
    try { await mutate({ type: 'DELETE_ITEM', id: item.id }); await renderList(); element('list-status').textContent = t('deleted'); }
    catch (error) { del.disabled = false; element('list-status').textContent = t('deleteFailed', { reason: errorText(error) }); }
  });

  actions.append(edit, del);
  li.append(body, tags, note, actions);
  return li;
}

// The editor holds unsaved text in this tab only.
let editSession = null;

function renderNoteCount() {
  const note = element('edit-note');
  const count = noteLength(note.value);
  const over = count > MAX_REMARK_LENGTH;
  const unchanged = note.value === editSession?.original.remark;
  const key = over && unchanged ? 'editLegacyNoteCount' : 'editNoteCount';
  element('edit-note-count').textContent = t(key, { count, limit: MAX_REMARK_LENGTH });
  if (over && !unchanged) note.setAttribute('aria-invalid', 'true');
}

function openEditor(item) {
  const returnTo = collectionHash(selectedView);
  element('edit-back').href = returnTo;
  element('edit-cancel').href = returnTo;
  element('edit-form').hidden = !item;
  element('edit-missing').hidden = !!item;
  element('edit-item-name').textContent = item ? item.title?.trim() || item.url || t('untitled') : '';
  if (!item) { editSession = null; return; }

  const tags = element('edit-tags'), note = element('edit-note');
  tags.value = (item.tags || []).join('\n');
  note.value = readingNote(item);
  editSession = { itemId: item.id, original: { tags: tags.value, remark: note.value }, saving: false };
  tags.removeAttribute('aria-invalid');
  note.removeAttribute('aria-invalid');
  element('edit-feedback').textContent = '';
  setEditorBusy(false);
  renderNoteCount();
}

function setEditorBusy(saving) {
  element('edit-form').setAttribute('aria-busy', String(saving));
  for (const id of ['edit-tags', 'edit-note', 'edit-save']) element(id).disabled = saving;
}

async function returnToList() {
  history.replaceState(null, '', collectionHash(selectedView));
  await showLocation({ focus: true });
}

async function saveEditor(event) {
  event.preventDefault();
  const session = editSession;
  if (!session || session.saving) return;
  const feedback = element('edit-feedback');
  const metadata = {};
  for (const [key, id] of [['tags', 'edit-tags'], ['remark', 'edit-note']]) {
    const input = element(id);
    if (input.value === session.original[key]) continue;
    const value = key === 'tags' ? input.value.split(/\r?\n/).map(tag => tag.trim()).filter(Boolean) : input.value;
    try { Object.assign(metadata, normalizeCaptureMetadata({ [key]: value })); }
    catch (error) {
      input.setAttribute('aria-invalid', 'true');
      feedback.setAttribute('data-state', 'error');
      feedback.textContent = errorText(error);
      input.focus();
      return;
    }
  }
  if (!Object.keys(metadata).length) return returnToList();

  session.saving = true;
  setEditorBusy(true);
  feedback.setAttribute('data-state', 'info');
  feedback.textContent = t('editSaving');
  try {
    await mutate({ type: 'UPDATE_METADATA', id: session.itemId, metadata });
    if (editSession !== session) return;
    await returnToList();
    element('list-status').textContent = t('editSaved');
  } catch (error) {
    if (editSession !== session) return;
    feedback.setAttribute('data-state', 'error');
    feedback.textContent = t('editFailed', { reason: errorText(error) });
  } finally {
    if (editSession === session) {
      session.saving = false;
      setEditorBusy(false);
    }
  }
}

// ===========================================================================
// SETTINGS
// ===========================================================================

async function mutate(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.ok) throw Object.assign(new Error(result?.error || t('genericFailure')), { diagnostic: result?.diagnostic });
  return result;
}
let connection = null, pairingState = { approved: false }, validationSequence = 0, checkingConnection = false;
let authError = null;
const element = id => document.getElementById(id);
let currentRoute = 'settings';
let configuredLibrary = false, busyAction = null;
function applyRoute(route) {
  currentRoute = ROUTES.includes(route) ? route : 'settings';
  if (currentRoute !== 'reading-list') setFolderPickerOpen(false);
  for (const view of ROUTES) element(view).hidden = view !== currentRoute;
  const activeSection = currentRoute === 'edit-item' ? 'reading-list' : currentRoute;
  for (const [id, view] of [['nav-collection', 'reading-list'], ['nav-settings', 'settings']]) {
    if (view === activeSection) element(id).setAttribute('aria-current', 'page'); else element(id).removeAttribute('aria-current');
  }
  document.title = `ReadFlow · ${t({ 'reading-list': 'collection', 'edit-item': 'editItem', settings: 'settings' }[currentRoute])}`;
}
async function showLocation({ refresh = false, focus = false } = {}) {
  const hash = location.hash;
  const previousRoute = currentRoute;
  const { route, view, itemId } = parseHash(hash);
  const nextView = view || (hash.startsWith('#reading-list/') ? 'later' : selectedView);
  if (nextView !== selectedView) { selectedView = nextView; clearListFilters(); }
  if (route === 'edit-item') {
    const item = (await getItems()).find(item => item.id === itemId && !isLibraryDeleted(item));
    if (location.hash !== hash) return;
    applyRoute(route);
    openEditor(item);
    if (focus) element('edit-heading').focus();
    return;
  }
  editSession = null;
  applyRoute(route);
  if (route === 'reading-list') {
    await renderList();
    if (focus && previousRoute === 'edit-item' && currentRoute === 'reading-list') element('list-heading').focus();
    if (refresh) await refreshLibrary();
  }
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
  const fingerprint = displayPairingFingerprint(pair.fingerprint);
  element('pair-status').textContent = t(pair.approved || pair.status === 'approved' ? 'pairApproved' : pair.status === 'pending' ? 'pairPending' : 'pairUnpaired');
  element('pair-fingerprint').textContent = fingerprint ? t('pairFingerprint', { fingerprint: fingerprint.groups, code: fingerprint.code }) : '';
  element('pair-details').hidden = !fingerprint;
  element('copy-pair-task').disabled = !fingerprint || !!busyAction;
  element('pair-task').value = fingerprint ? t('pairTask', { endpoint: visibleEndpoint, extensionId: chrome.runtime.id || '', pairId: pair.pairId, fingerprint: pair.fingerprint, code: fingerprint.code }) : '';
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
      await renderList();
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
  element('collection-setup').hidden = configuredLibrary;
  element('home-status').textContent = configuredLibrary ? '' : t('homeNeedsSetup');
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
    checkingConnection = false; authError = error;
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
      if (['CLOCK_SKEW', 'EXTENSION_ID_UNSET'].includes(error.diagnostic?.code)) {
        authError = error;
        renderConnection(null);
        return;
      }
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
    history.replaceState(null, '', collectionHash(view));
    await renderList();
  });
  element('filter-type').addEventListener('change', renderList);
  element('edit-form').addEventListener('submit', saveEditor);
  for (const id of ['edit-tags', 'edit-note']) element(id).addEventListener('input', () => {
    element(id).removeAttribute('aria-invalid');
    element('edit-feedback').textContent = '';
    if (id === 'edit-note') renderNoteCount();
  });
  for (const id of ['edit-back', 'edit-cancel']) element(id).addEventListener('click', event => {
    event.preventDefault();
    if (!editSession?.saving) return returnToList();
  });
  const folderButton = element('open-folder-form');
  folderButton.appendChild(svg([folderIcon, 'M12 10v6m-3-3h6']));
  const picker = element('folder-picker');
  picker.appendChild(svg(chevronIcon));
  picker.addEventListener('click', () => setFolderPickerOpen(picker.getAttribute('aria-expanded') !== 'true'));
  element('library-sidebar').addEventListener('keydown', event => {
    if (event.key === 'Escape' && !event.defaultPrevented && folderPickerIsOpen()) {
      event.preventDefault();
      setFolderPickerOpen(false, true);
    }
  });
  folderButton.addEventListener('click', () => {
    const form = element('folder-form');
    if (!form.hidden) { closeFolderForm(true); return; }
    element('folder-status').textContent = '';
    form.hidden = false;
    folderButton.setAttribute('aria-expanded', 'true');
    element('folder-name').focus();
  });
  element('cancel-folder').addEventListener('click', () => closeFolderForm(true));
  element('folder-name').addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeFolderForm(true); }
  });
  element('folder-form').addEventListener('submit', async event => {
    event.preventDefault();
    const input = element('folder-name'), button = element('create-folder'), feedback = element('folder-status');
    if (button.disabled || element('folder-form').hidden) return;
    const name = input.value.trim();
    if (!isFolderName(name)) {
      input.setAttribute('aria-invalid', 'true');
      feedback.textContent = '请输入 1 到 80 字的文件夹名称。';
      return;
    }
    input.removeAttribute('aria-invalid');
    const fromFolder = selectedFolder;
    const parentId = fromFolder && fromFolder !== unfiled ? fromFolder : null;
    const cancel = element('cancel-folder');
    button.disabled = true; input.disabled = true; cancel.disabled = true; folderButton.disabled = true;
    let created = false;
    try {
      const result = await mutate({ type: 'CREATE_FOLDER', name, parentId });
      created = true;
      if (selectedView === 'reference' && selectedFolder === fromFolder) {
        if (parentId) expandedFolders.add(parentId);
        selectedFolder = result.folderId;
        selectedItem = null; selectedTag = '';
      }
      closeFolderForm(false);
      feedback.textContent = '文件夹已建立。';
    } catch (error) { feedback.textContent = errorText(error); }
    finally {
      button.disabled = false; input.disabled = false; cancel.disabled = false;
      await renderList();
      if (created && selectedView === 'reference' && currentRoute === 'reading-list') folderButton.focus();
    }
  });
  element('filter-starred').addEventListener('change', renderList);
  element('filter-search').addEventListener('input', renderList);
  element('clear-filters').addEventListener('click', async () => {
    const folder = selectedFolder;
    clearListFilters();
    selectedFolder = folder;
    await renderList();
  });
  applyRoute(parseHash(location.hash).route);
  globalThis.addEventListener?.('hashchange', () => showLocation({ refresh: true, focus: true }));
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
    applyRoute(currentRoute);
    if (editSession) renderNoteCount();
    await renderList(); await showSyncStatus();
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

  await showLocation({ refresh: true });

  // Keep the list fresh if a save happens (from the toolbar icon) while this
  // tab is open.
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.items) renderList();
    if (changes.knowledgeSync) { showSyncStatus(); renderList(); }
  });
}

init();

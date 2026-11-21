import { readingNote } from './lib/reading-note.js';
import { requestPairing, getPairingStatus } from './lib/pairing-client.js';
import { SafeError, safeErrorMessage } from './lib/security.js';
import { getItems, setItems, setSettings, setRead, setReadingStatus, prepareCapture, deleteItem, disconnectCollection } from './lib/storage.js';
import { callKnowledge, mergeKnowledge } from './lib/knowledge.js';
import { callConnection, connectionStatus } from './lib/connection.js';
import { organization, inferContentType } from './lib/organization.js';
import { normalizeCaptureMetadata } from './lib/capture-metadata.js';
import { libraryRecordId, libraryBase, isLibraryDeleted } from './lib/library-binding.js';
import { isSafeArticleUrl, normalizeArticleUrl } from './lib/security.js';

let queue = Promise.resolve();
function enqueue(work) {
  const task = queue.then(work);
  queue = task.catch(() => {});
  return task;
}
async function reportError(error) {
  await chrome.action.setBadgeText({ text: '!' });
  await chrome.action.setBadgeBackgroundColor({ color: '#9f401f' });
  await chrome.action.setTitle({ title: safeErrorMessage(error) + ' — Right-click ReadFlow to open Settings.' });
}
// Refresh only acknowledged records; never replay locally pending captures or edits.
const acknowledgedItems = items => items.filter(item => libraryRecordId(item) && !isLibraryDeleted(item)).map(({ metadataUpdate, ...item }) => item);
async function requireCaptureConnection() {
  const { collectionIdentity } = await chrome.storage.local.get('collectionIdentity');
  if (!collectionIdentity || !(await getPairingStatus()).approved) throw new SafeError('Connect your library in Settings before saving.');
}
async function syncReadingLibrary() {
  try {
    const result = await callKnowledge('sync', { items: acknowledgedItems(await getItems()) });
    if (result.enabled) {
      const merged = mergeKnowledge(await getItems(), result);
      await setItems(merged);
      if (merged.some(item => item.metadataUpdate && !isLibraryDeleted(item))) throw new SafeError('Tags or remarks are still pending. Check the ReadFlow service before retrying.');
    }
    await chrome.storage.local.set({ knowledgeSync: { enabled: result.enabled, at: Date.now(), error: null,
      folders: result.folders, tagOptions: result.captureMetadata?.tagOptions || [] } });
    await chrome.action.setBadgeText({ text: '' });
    await chrome.action.setTitle({ title: 'ReadFlow — Home, Collection and Settings' });
    return result;
  } catch (error) {
    const { knowledgeSync } = await chrome.storage.local.get('knowledgeSync');
    await chrome.storage.local.set({ knowledgeSync: { ...knowledgeSync, enabled: true, error: safeErrorMessage(error) } });
    await reportError(error);
    throw error;
  }
}
async function initializeAlarms() {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  for (const alarm of await chrome.alarms.getAll()) {
    if (alarm.name.startsWith('review:')) await chrome.alarms.clear(alarm.name);
  }
  await chrome.storage.local.remove(['reviews', 'localCaptureMode']);
  if (!(await chrome.alarms.get('knowledge-sync'))) await chrome.alarms.create('knowledge-sync', { periodInMinutes: 15 });
}
chrome.runtime.onInstalled.addListener((details = {}) => {
  if (details.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('src/options.html') + '#settings' });
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'open-list', title: 'Reading list', contexts: ['action'] });
    chrome.contextMenus.create({ id: 'open-home', title: 'Home', contexts: ['action'] });
    chrome.contextMenus.create({ id: 'open-settings', title: 'Settings', contexts: ['action'] });
    chrome.contextMenus.create({ id: 'sync-knowledge', title: 'Sync reading library', contexts: ['action'] });
  });
  enqueue(async () => { await initializeAlarms(); await syncReadingLibrary(); }).catch(() => console.warn('ReadFlow operation failed; check Settings.'));
});
chrome.contextMenus.onClicked.addListener(info => {
  if (info.menuItemId === 'sync-knowledge') enqueue(syncReadingLibrary).catch(() => console.warn('ReadFlow operation failed; check Settings.'));
  else chrome.tabs.create({ url: chrome.runtime.getURL('src/options.html') +
    (info.menuItemId === 'open-settings' ? '#settings' : info.menuItemId === 'open-home' ? '' : '#reading-list') });
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== 'knowledge-sync') return;
  enqueue(async () => {
    const { knowledgeSync } = await chrome.storage.local.get('knowledgeSync');
    if (knowledgeSync?.enabled) await syncReadingLibrary();
  }).catch(() => console.warn('ReadFlow operation failed; check Settings.'));
});
chrome.runtime.onStartup.addListener(() => {
  enqueue(async () => { await initializeAlarms(); await syncReadingLibrary(); }).catch(() => console.warn('ReadFlow operation failed; check Settings.'));
});
async function capturePage(tab, metadata = {}) {
  if (!/^https?:\/\//i.test(tab?.url || '')) {
    const error = new SafeError('This page cannot be saved. Open an HTTP(S) article or video page and try again.');
    await reportError(error); throw error;
  }
  await requireCaptureConnection();
  const previous = await getItems();
  // Construct in memory only. Nothing is stored until the database acknowledges it.
  const candidate = prepareCapture(previous, { url: tab.url, title: tab.title, metadata });
  const submitted = [candidate, ...acknowledgedItems(previous).filter(item => item.id !== candidate.id)];
  try {
    if (['purpose', 'contentType', 'starred', 'folderId'].some(key => Object.hasOwn(metadata, key))) {
      const health = await callConnection('health');
      if (!health.capabilities?.organization) throw new SafeError('Update the ReadFlow server to support purposes, types and stars.');
      if (Object.hasOwn(metadata, 'folderId') && !health.capabilities?.folders) throw new SafeError('Update the ReadFlow server to manage folders.');
    }
    const result = await callKnowledge('sync', { items: submitted });
    const binding = result.bindings?.find(value => value.id === candidate.id);
    if (!result.enabled || !binding || !result.articles?.some(value => value.recordId === binding.recordId) ||
        candidate.metadataUpdate && !result.metadataBindings?.some(value => value.id === candidate.id && value.editId === candidate.metadataUpdate.id)) {
      throw new SafeError('Save was not confirmed by the database. Refresh the library before retrying.');
    }
    const confirmed = mergeKnowledge(submitted, result);
    const legacy = previous.filter(item => !submitted.some(sent => sent.id === item.id) &&
      !confirmed.some(saved => saved.url === item.url && libraryRecordId(saved)));
    await setItems([...confirmed, ...legacy]);
    await chrome.storage.local.set({ knowledgeSync: { enabled: true, at: Date.now(), error: null, folders: result.folders, tagOptions: result.captureMetadata?.tagOptions || [] } });
    await showCaptureFeedback('Saved to ReadFlow', 'Saved to the ReadFlow database.');
    return { ok: true, saved: true, synced: true };
  } catch (error) {
    const detail = safeErrorMessage(error);
    const message = detail.includes('Connection failed or timed out') ? 'Network problem, save failed.' : detail;
    await showCaptureFeedback('Save failed', message, true);
    return { ok: false, saved: false, synced: false, error: message };
  }
}
// Fallback for builds without a popup; the shipped action opens popup.html.
chrome.action.onClicked.addListener(tab => {
  enqueue(() => capturePage(tab)).catch(error => { if (!(error instanceof SafeError)) console.warn('ReadFlow operation failed; check Settings.'); });
});
// Serialize dashboard mutations with background sync, so local writes do not
// overwrite a newer database snapshot while a send is in flight.
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const source = sender.url?.split(/[?#]/)[0];
  const fromOptions = source === chrome.runtime.getURL('src/options.html');
  const fromPopup = source === chrome.runtime.getURL('src/popup.html');
  if (sender.id !== chrome.runtime.id || sender.frameId !== undefined && sender.frameId !== 0 || !fromOptions && !fromPopup) return;
  if (fromPopup && !['CAPTURE_PAGE', 'CAPTURE_CONTEXT', 'POPUP_STATUS'].includes(message?.type)) return;
  if (fromOptions && ['CAPTURE_PAGE', 'CAPTURE_CONTEXT'].includes(message?.type)) return;
  if (!['POPUP_STATUS', 'CAPTURE_PAGE', 'CAPTURE_CONTEXT', 'UPDATE_METADATA', 'CREATE_FOLDER', 'SET_STATUS', 'SET_READ', 'DELETE_ITEM', 'SAVE_SETTINGS', 'CONNECTION_STATUS', 'SYNC', 'VALIDATE_CONNECTION', 'DISCONNECT', 'PAIR_REQUEST', 'PAIR_STATUS', 'EXPORT_CSV'].includes(message?.type)) return;
  if (!message || typeof message !== 'object' || JSON.stringify(message).length > 8192) { reply({ ok: false, error: 'Invalid request.' }); return; }
  enqueue(async () => {
    if (message.type === 'CREATE_FOLDER') {
      await requireCaptureConnection();
      const current = (await chrome.storage.local.get('knowledgeSync')).knowledgeSync || {};
      if (!Array.isArray(current.folders)) throw new SafeError('Update the ReadFlow server and refresh the library to manage folders.');
      const result = await callConnection('folders', { name: message.name, parentId: message.parentId });
      await chrome.storage.local.set({ knowledgeSync: { ...current, folders: result.folders } });
      return { ok: true, folderId: result.folderId };
    }
    if (message.type === 'EXPORT_CSV') return callConnection('csv');
    if (message.type === 'POPUP_STATUS') {
      const { collectionIdentity } = await chrome.storage.local.get('collectionIdentity');
      const pair = await getPairingStatus();
      if (!collectionIdentity || !pair.approved) return { ok: true, connected: false };
      return { ok: true, connected: true }; // Saving still requires a live database acknowledgement.
    }
    if (message.type === 'UPDATE_METADATA') {
      if (Object.keys(message).some(key => !['type', 'id', 'metadata'].includes(key))) throw new SafeError('Invalid capture request.');
      const item = (await getItems()).find(item => item.id === message.id && !isLibraryDeleted(item));
      if (!libraryRecordId(item)) throw new SafeError('Refresh the library before editing this item.');
      return capturePage({ url: item.url, title: item.title }, normalizeCaptureMetadata(message.metadata));
    }
    if (message.type === 'CAPTURE_PAGE') {
      if (Object.keys(message).some(key => !['type', 'metadata', 'expectedUrl'].includes(key))) throw new SafeError('Invalid capture request.');
      const metadata = normalizeCaptureMetadata(message.metadata);
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (message.expectedUrl !== undefined && message.expectedUrl !== tab?.url) throw new SafeError('The active page changed. Reopen the popup before saving.');
      return capturePage(tab, metadata);
    }
    if (message.type === 'CAPTURE_CONTEXT') {
      await requireCaptureConnection();
      if (Object.keys(message).some(key => key !== 'type')) throw new SafeError('Invalid capture request.');
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!isSafeArticleUrl(tab?.url)) throw new SafeError('This page cannot be saved. Open an HTTP(S) article or video page and try again.');
      await syncReadingLibrary();
      const items = await getItems();
      const href = normalizeArticleUrl(tab.url);
      const item = items.find(item => !isLibraryDeleted(item) && (item.url === href || normalizeArticleUrl(item.url) === href));
      const { knowledgeSync } = await chrome.storage.local.get('knowledgeSync');
      const inferredContentType = inferContentType(tab.url);
      const current = item ? organization(item) : { purpose: 'later', contentType: inferredContentType, starred: false };
      return { ok: true, existing: !!item, ...current, inferredContentType, url: tab.url, title: item?.title || tab.title || tab.url, tags: item?.tags || [], remark: readingNote(item),
        tagOptions: [...new Set([...(item?.tags || []), ...(knowledgeSync?.tagOptions || []), ...items.flatMap(item => item.tags || [])])] };
    }
    if (['SET_READ', 'SET_STATUS', 'DELETE_ITEM'].includes(message.type) && (typeof message.id !== 'string' || message.id.length > 512)) throw new SafeError('Invalid item ID.');
    if (message.type === 'DISCONNECT') { await chrome.storage.local.remove('pendingConnectionSetup'); return disconnectCollection(); }
    if (message.type === 'PAIR_REQUEST') {
      const pair = await requestPairing(message.connectionUrl);
      const { pendingConnectionSetup } = await chrome.storage.local.get('pendingConnectionSetup');
      await chrome.storage.local.set({ pendingConnectionSetup: { endpoint: message.connectionUrl, ...pair,
        startedAt: pendingConnectionSetup?.pairId === pair.pairId ? pendingConnectionSetup.startedAt : Date.now() } });
      return { ok: true, ...pair };
    }
    if (message.type === 'PAIR_STATUS') return { ok: true, ...await getPairingStatus() };
    if (message.type === 'VALIDATE_CONNECTION') {
      return { ok: true, ...await callConnection('health', {}, { pinIdentity: false, endpoint: message.connectionUrl }) };
    }
    if (message.type === 'SAVE_SETTINGS') { const settings = await setSettings(message.settings); await chrome.storage.local.remove('pendingConnectionSetup'); return { ok: true, settings }; }
    if (message.type === 'CONNECTION_STATUS') return { ok: true, ...await callConnection('health', {}, { endpoint: message.connectionUrl }) };
    if (message.type === 'SYNC') { await syncReadingLibrary(); return { ok: true }; }
    if (message.type === 'SET_STATUS') {
      await setReadingStatus(message.id, message.status);
    } else if (message.type === 'SET_READ') {
      if (typeof message.read !== 'boolean') throw new SafeError('Invalid reading status.');
      await setRead(message.id, message.read);
    } else {
      const item = (await getItems()).find(item => item.id === message.id);
      const recordId = libraryRecordId(item);
      if (recordId && !isLibraryDeleted(item)) {
        const result = await callConnection('delete', { recordId, base: libraryBase(item) });
        if (result.deleted !== true || result.recordId !== recordId) throw new SafeError('Deletion was not confirmed. Refresh the library before retrying.');
      }
      await deleteItem(message.id);
    }
    return { ok: true };
  }).then(reply, error => reply({ ok: false, error: safeErrorMessage(error) }));
  return true;
});
// Toolbar feedback needs no script injection or page-content access.
async function showCaptureFeedback(title, note, warning = false) {
  await chrome.action.setBadgeBackgroundColor({ color: warning ? '#9f401f' : '#23734d' });
  await chrome.action.setBadgeText({ text: warning ? '!' : '✓' });
  await chrome.action.setTitle({ title: title + ' · ' + note + ' — Right-click → Reading list.' });
}
// Alarms can disappear on restart/update; restore them whenever the worker loads.
enqueue(initializeAlarms).catch(() => console.warn('ReadFlow operation failed; check Settings.'));

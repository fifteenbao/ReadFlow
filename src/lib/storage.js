import { SafeError, normalizeArticleUrl } from './security.js';
import { callConnection } from './connection.js';
import { normalizeCaptureMetadata } from './capture-metadata.js';
import { normalizeLibraryItem, isLibraryDeleted } from './library-binding.js';
import { LIBRARY_ITEM_LIMIT } from './library-limits.js';
import { storedEndpoint, endpointValue, releaseEndpointPermission, endpointPermission, collectionArchiveKey } from './endpoint.js';

const ITEMS_KEY = 'items';
const SETTINGS_KEY = 'settings';
export const DEFAULT_SETTINGS = { language: 'zh' };
const sameUrl = (a, b) => a === b || normalizeArticleUrl(a) === b;

export async function getItems() {
  const data = await chrome.storage.local.get(ITEMS_KEY);
  return (data[ITEMS_KEY] || []).map(normalizeLibraryItem);
}
export async function setItems(items) {
  const normalized = items.map(normalizeLibraryItem);
  if (normalized.filter(item => !isLibraryDeleted(item)).length > LIBRARY_ITEM_LIMIT) {
    throw new SafeError(`Library is full (${LIBRARY_ITEM_LIMIT} items). Delete some items before saving new ones.`);
  }
  await chrome.storage.local.set({ [ITEMS_KEY]: normalized });
}
export function prepareCapture(items, { url, title, metadata = {} }) {
  const normalizedUrl = normalizeArticleUrl(url);
  if (!normalizedUrl) throw new SafeError('This URL is invalid or contains credentials or authentication parameters. It was not saved.');
  const fields = normalizeCaptureMetadata(metadata);
  title = typeof title === 'string' ? title.slice(0, 1000) : '';
  const existing = items.map(normalizeLibraryItem).find(item => sameUrl(item.url, normalizedUrl) && !isLibraryDeleted(item));
  if (existing) {
    if (!Object.keys(fields).length) return existing;
    const next = { ...existing, url: normalizedUrl, ...fields, metadataUpdate: { id: crypto.randomUUID(), fields: { ...existing.metadataUpdate?.fields, ...fields } } };
    return next;
  }
  if (items.filter(item => !isLibraryDeleted(item)).length >= LIBRARY_ITEM_LIMIT) {
    throw new SafeError(`Library is full (${LIBRARY_ITEM_LIMIT} items). Delete some items before saving new ones.`);
  }
  const item = { id: crypto.randomUUID(), url: normalizedUrl, title: title || normalizedUrl,
    savedAt: new Date().toISOString(), ...fields,
    ...(Object.keys(fields).length ? { metadataUpdate: { id: crypto.randomUUID(), fields } } : {}) };
  return item;
}
export async function addItem(capture) {
  const items = await getItems();
  const item = prepareCapture(items, capture);
  await setItems([item, ...items.filter(old => old.id !== item.id)]);
  return item;
}
export async function deleteItem(id) {
  const items = (await getItems()).filter(item => item.id !== id);
  await setItems(items);
  return items;
}
export async function getSettings() {
  const data = await chrome.storage.local.get([SETTINGS_KEY, 'connectionEndpoint']);
  const { settings = {} } = data;
  const endpoint = storedEndpoint(data);
  return { ...(endpoint ? { connectionUrl: endpoint } : {}), language: settings.language === 'en' ? 'en' : 'zh', provider: 'database' };
}
export function validateSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new SafeError('Invalid settings.');
  if (settings.provider !== undefined && settings.provider !== 'database') throw new SafeError('Only the ReadFlow database provider is supported.');
  if (settings.connectionUrl !== undefined && typeof settings.connectionUrl !== 'string') throw new SafeError('Enter a valid HTTPS connection service address.');
  return { ...(typeof settings.connectionUrl === 'string' ? { connectionUrl: endpointValue(settings.connectionUrl) } : {}), language: settings.language === 'en' ? 'en' : 'zh', provider: 'database' };
}
export async function setSettings(settings) {
  const next = validateSettings(settings);
  const provider = 'database';
  const current = await chrome.storage.local.get(['collectionIdentity', 'connectionProvider', 'connectionEndpoint', 'connectionBaseUrl']);
  if (current.collectionIdentity && (current.connectionProvider || 'database') !== 'database') throw new SafeError('Disconnect the current collection before reconnecting to the database.');
  const endpoint = next.connectionUrl !== undefined ? next.connectionUrl : storedEndpoint(current);
  const previous = storedEndpoint(current);
  if (current.collectionIdentity && endpoint !== previous) throw new SafeError('Disconnect the current collection before changing the connection address.');
  if (endpoint && !await chrome.permissions.contains(endpointPermission(endpoint))) throw new SafeError('Grant access to this connection host in Settings before connecting.');
  const dataPair = (await chrome.storage.local.get('connectionPairings')).connectionPairings?.[endpoint];
  if (endpoint && dataPair?.status !== 'approved') throw new SafeError('Pair this browser in Settings and confirm the request on the server before connecting.');
  const result = await callConnection('preferences', { language: next.language }, { provider, endpoint, pinIdentity: false });
  const data = await chrome.storage.local.get(['collectionArchives', 'items']);
  const archive = result.identity && data.collectionArchives?.[collectionArchiveKey(result.identity, endpoint)];
  await chrome.storage.local.set({ [SETTINGS_KEY]: next, connectionProvider: provider, connectionEndpoint: endpoint,
    ...(result.identity ? { collectionIdentity: result.identity } : {}),
    ...(!current.collectionIdentity && Array.isArray(archive) ? { items: [...archive, ...(data.items || []).filter(item => !archive.some(old => old.id === item.id))].map(normalizeLibraryItem) } : {}),
    connectionAccessKey: '', connectionBaseUrl: endpoint, connectionKeySavedAt: null });
  if (endpoint !== previous) await releaseEndpointPermission(previous, endpoint);
  return next;
}

// Preserve separate collections; no remote deletion or credential revocation.
export async function disconnectCollection() {
  const data = await chrome.storage.local.get(['items', 'collectionIdentity', 'collectionArchives', 'connectionEndpoint', 'connectionBaseUrl']);
  const archives = data.collectionArchives || {};
  if (data.collectionIdentity && data.items?.length) {
    archives[collectionArchiveKey(data.collectionIdentity, storedEndpoint(data) || data.connectionBaseUrl || '')] = data.items.map(normalizeLibraryItem);
  }
  // One atomic storage update prevents loss if Chrome quota is reached.
  await chrome.storage.local.set({ collectionArchives: archives, items: data.collectionIdentity ? [] : (data.items || []).map(normalizeLibraryItem), settings: { language: 'zh' }, collectionIdentity: null,
    connectionEndpoint: '', connectionAccessKey: '', connectionKeySavedAt: null, connectionBaseUrl: '', connectionProvider: 'database', knowledgeSync: null });
  await releaseEndpointPermission(storedEndpoint(data));
  return { ok: true };
}

import { organization } from './organization.js';
import { isSafeArticleUrl, SafeError } from './security.js';
import { callConnection } from './connection.js';
import { normalizeLibraryItem, isLibraryDeleted } from './library-binding.js';
import { LIBRARY_ITEM_LIMIT } from './library-limits.js';
export const callKnowledge = (action, payload) => callConnection(action, payload);

// Reconcile remote fields while retaining unacknowledged explicit capture edits.
export function mergeKnowledge(items, result) {
  const bindings = new Map(result.bindings.map(b => [b.id, b.recordId]));
  const records = new Map(result.articles.map(a => [a.recordId, a]));
  const acknowledgements = new Map((result.metadataBindings || []).map(binding => [binding.id, binding.editId]));
  const fromRecord = (item, record, pending) => normalizeLibraryItem({
    ...item, metadataUpdate: pending, tags: record.tags || [], remark: record.remark || '',
    ...organization(record), folderId: record.folderId ?? null, organizationSources: record.organizationSources, ...pending?.fields,
    title: record.title || item.title, url: record.url,
    libraryRecordId: record.recordId, libraryBase: result.base, notifiedAt: null, libraryDeleted: false,
  });
  const merged = items.map(normalizeLibraryItem).map(item => {
    const record = records.get(bindings.get(item.id));
    if (!record) {
      if (item.libraryBase === result.base && item.libraryRecordId) return { ...item, libraryDeleted: true };
      return item;
    }
    const pending = item.metadataUpdate && acknowledgements.get(item.id) !== item.metadataUpdate.id ? item.metadataUpdate : undefined;
    return fromRecord(item, record, pending);
  });
  const known = new Set(merged.filter(it => it.libraryBase === result.base).map(it => it.libraryRecordId));
  for (const record of result.articles) {
    if (known.has(record.recordId) || !isSafeArticleUrl(record.url)) continue;
    merged.push(fromRecord({
      id: `library:${result.base}/${record.recordId}`,
      savedAt: new Date(Number.isFinite(record.savedAt) ? record.savedAt : Date.now()).toISOString(),
    }, record));
  }
  if (merged.filter(item => !isLibraryDeleted(item)).length > LIBRARY_ITEM_LIMIT) {
    throw new SafeError(`Library is full (${LIBRARY_ITEM_LIMIT} items). Delete some items before saving new ones.`);
  }
  return merged;
}

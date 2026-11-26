// Chrome used to store SQLite bindings under feishu* names from the Bitable era.
export function normalizeLibraryItem(item) {
  if (!item || typeof item !== 'object') return item;
  const next = { ...item };
  if (next.libraryRecordId === undefined && next.feishuRecordId !== undefined) {
    next.libraryRecordId = next.feishuRecordId;
  }
  if (next.libraryBase === undefined && next.feishuBase !== undefined) {
    next.libraryBase = next.feishuBase;
  }
  if (next.libraryDeleted === undefined && next.feishuDeleted !== undefined) {
    next.libraryDeleted = next.feishuDeleted;
  }
  delete next.feishuRecordId;
  delete next.feishuBase;
  delete next.feishuDeleted;
  delete next.snoozedUntil;
  delete next.status;
  delete next.read;
  delete next.readAt;
  return next;
}
export function libraryRecordId(item) {
  return item?.libraryRecordId ?? item?.feishuRecordId;
}
export function libraryBase(item) {
  return item?.libraryBase ?? item?.feishuBase;
}
export function isLibraryDeleted(item) {
  return item?.libraryDeleted === true || item?.feishuDeleted === true;
}

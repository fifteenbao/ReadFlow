import { READING_STATUSES } from './reading-state.js';

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
  if (READING_STATUSES.includes(next.status)) next.read = next.status !== '待阅读';
  else {
    next.status = next.read ? '已读' : '待阅读';
    next.read = next.status !== '待阅读';
  }
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

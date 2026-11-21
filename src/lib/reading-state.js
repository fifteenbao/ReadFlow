export const READING_STATUSES = ['待阅读', '已读', '跳过'];
/** Prefer status; derive from read only when status is missing. */
export const readingStatus = item => READING_STATUSES.includes(item?.status) ? item.status : item?.read ? '已读' : '待阅读';
export const isUnread = item => readingStatus(item) === '待阅读' && item?.libraryDeleted !== true && item?.feishuDeleted !== true;

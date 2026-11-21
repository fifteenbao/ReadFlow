import { PURPOSES, CONTENT_TYPES, ORGANIZATION_SOURCES } from './organization.js';
import { isFolderId } from './folders.js';
import { SafeError } from './security.js';

export const CAPTURE_FIELDS = Object.freeze({ 标签: 4, 备注: 1 });
export const MAX_TAG_LENGTH = 50;
export const MAX_REMARK_LENGTH = 140;
export const noteLength = text => [...text].length;
export function normalizeCaptureMetadata(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !['tags', 'remark', 'purpose', 'contentType', 'starred', 'organizationSources', 'folderId'].includes(key))) throw new SafeError('Invalid capture metadata.');
  const result = {};
  for (const [key, values] of [['purpose', PURPOSES], ['contentType', CONTENT_TYPES]]) {
    if (Object.hasOwn(value, key)) {
      if (!values.includes(value[key])) throw new SafeError('Invalid capture metadata.');
      result[key] = value[key];
    }
  }
  if (Object.hasOwn(value, 'starred')) {
    if (typeof value.starred !== 'boolean') throw new SafeError('Invalid capture metadata.');
    result.starred = value.starred;
  }
  if (Object.hasOwn(value, 'organizationSources')) {
    const sources = value.organizationSources;
    if (!sources || typeof sources !== 'object' || Array.isArray(sources) ||
        Object.keys(sources).some(key => !['purpose', 'contentType', 'starred'].includes(key)) ||
        Object.values(sources).some(source => !ORGANIZATION_SOURCES.includes(source))) {
      throw new SafeError('Invalid capture metadata.');
    }
    result.organizationSources = { ...sources };
  }
  if (Object.hasOwn(value, 'folderId')) {
    if (value.folderId !== null && !isFolderId(value.folderId)) throw new SafeError('Invalid folder.');
    result.folderId = value.folderId;
  }
  if (Object.hasOwn(value, 'tags')) {
    if (!Array.isArray(value.tags) ||
        value.tags.some(tag => typeof tag !== 'string' || !tag.trim() || tag.trim().length > MAX_TAG_LENGTH || /[\u0000-\u001f\u007f]/.test(tag))) {
      throw new SafeError('Each tag must contain 1–50 characters.');
    }
    result.tags = [...new Set(value.tags.map(tag => tag.trim().normalize('NFC')))];
  }
  if (Object.hasOwn(value, 'remark')) {
    if (typeof value.remark !== 'string' || noteLength(value.remark) > MAX_REMARK_LENGTH || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.remark)) throw new SafeError('Remarks must contain at most 140 characters.');
    result.remark = value.remark;
  }
  return result;
}
export function metadataUpdate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['id', 'fields'].includes(key)) ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.id || '')) throw new SafeError('Invalid capture metadata update.');
  const fields = normalizeCaptureMetadata(value.fields);
  if (!Object.keys(fields).length) throw new SafeError('Invalid capture metadata update.');
  return { id: value.id, fields };
}
export const metadataFields = value => ({ ...(value.tags !== undefined ? { 标签: value.tags } : {}), ...(value.remark !== undefined ? { 备注: value.remark } : {}) });

import { readingNote } from '../../src/lib/reading-note.js';
import { organization, organizationSources } from '../../src/lib/organization.js';
// RFC 4180 quoting plus spreadsheet-formula protection for user-controlled cells.
const cell = value => {
  let text = String(value ?? '');
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
};
const purposeLabel = { later: '稍后看', reference: '留作资料' };
const typeLabel = { article: '文章', video: '视频', tool: '工具', web: '其他网页' };
export function libraryCsv(articles, folders = []) {
  const folderPaths = new Map();
  for (const { id, name, parentId } of folders) {
    folderPaths.set(id, parentId ? `${folderPaths.get(parentId)} / ${name}` : name);
  }
  const rows = [['标题', '链接', '阅读状态', '时间', '标签', '笔记', '标记已读时间', '用途', '类型', '星标', '用途来源', '类型来源', '星标来源', '文件夹路径']];
  for (const a of articles) {
    const org = organization(a), sources = organizationSources(a);
    rows.push([a.title, a.url, a.status,
      Number.isFinite(a.savedAt) ? new Date(a.savedAt).toISOString() : '', (a.tags || []).join('; '), readingNote(a),
      Number.isFinite(a.readAt) ? new Date(a.readAt).toISOString() : '',
      purposeLabel[org.purpose], typeLabel[org.contentType], org.starred ? '是' : '否',
      sources.purpose, sources.contentType, sources.starred, folderPaths.get(a.folderId) || '']);
  }
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

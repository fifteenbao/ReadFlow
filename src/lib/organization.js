// Missing fields on older records are defaults, never inferred user intent.
export const PURPOSES = ['later', 'reference'];
export const CONTENT_TYPES = ['article', 'video', 'tool', 'web'];
export const ORGANIZATION_SOURCES = ['user', 'default', 'inferred'];
export function organization(item = {}) {
  return { purpose: PURPOSES.includes(item.purpose) ? item.purpose : 'later',
    contentType: CONTENT_TYPES.includes(item.contentType) ? item.contentType : 'web', starred: item.starred === true };
}
export function organizationSources(item = {}) {
  const sources = item.organizationSources && typeof item.organizationSources === 'object' ? item.organizationSources : {};
  return Object.fromEntries(['purpose', 'contentType', 'starred'].map(key => [
    key, ORGANIZATION_SOURCES.includes(sources[key]) ? sources[key] : 'default']));
}
export function inCollection(item, view) {
  const value = organization(item);
  return view === 'all' || value.purpose === view;
}
// Conservative URL hints only; never classify a whole site as tools. User may correct.
export function inferContentType(url) {
  try {
    const target = new URL(url);
    if (!/^https?:$/i.test(target.protocol)) return 'web';
    const host = target.hostname.replace(/^www\./i, '').toLowerCase();
    const path = `${target.pathname}${target.search}`.toLowerCase();
    if (/(^|\.)(youtube\.com|youtu\.be|bilibili\.com|b23\.tv|vimeo\.com|tiktok\.com|douyin\.com)$/i.test(host) ||
        /\/(watch|video|videos|shorts|clip|episode)(\/|$|\?)/i.test(path) || /[?&]v=/i.test(target.search)) return 'video';
    if (/(^|\.)(medium\.com|substack\.com|zhihu\.com|jianshu\.com|sspai\.com)$/i.test(host) ||
        /\/(blog|blogs|article|articles|posts|post|p|entry|story)(\/|$)/i.test(path)) return 'article';
  } catch {}
  return 'web';
}

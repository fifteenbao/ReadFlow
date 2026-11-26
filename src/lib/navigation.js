export const ROUTES = ['reading-list', 'edit-item', 'settings'];
export const COLLECTION_VIEWS = ['later', 'reference'];
export function parseHash(hash) {
  const requested = typeof hash === 'string' ? hash.replace(/^#/, '') : '';
  const [routePart, viewPart, action, itemPart, extra] = requested.split('/');
  const view = COLLECTION_VIEWS.includes(viewPart) ? viewPart : null;
  if (routePart === 'reading-list' && view && action === 'edit' && itemPart && extra === undefined) {
    try {
      const itemId = decodeURIComponent(itemPart);
      if (itemId.length <= 512 && !/[\u0000-\u001f\u007f]/.test(itemId)) return { route: 'edit-item', view, itemId };
    } catch { /* an invalid deep link opens the collection */ }
  }
  return {
    route: routePart === 'settings' ? 'settings' : 'reading-list',
    view,
  };
}

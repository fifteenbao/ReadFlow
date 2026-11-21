export const ROUTES = ['reading-list', 'settings'];
export const COLLECTION_VIEWS = ['later', 'reference', 'all'];
export function parseHash(hash) {
  const requested = typeof hash === 'string' ? hash.replace(/^#/, '') : '';
  const [routePart, viewPart] = requested.split('/');
  return {
    route: ROUTES.includes(routePart) ? routePart : 'reading-list',
    // Legacy #reading-list/starred falls back to later; star is a filter, not a top-level view.
    view: COLLECTION_VIEWS.includes(viewPart) ? viewPart : null,
  };
}
export function initialRoute(hash) {
  return parseHash(hash).route;
}
export function initialView(hash) {
  return parseHash(hash).view;
}

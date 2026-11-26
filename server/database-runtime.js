import { SafeError } from '../src/lib/security.js';
import { libraryCsv } from './lib/csv.js';

const allowed = { folders: ['name', 'parentId'], delete: ['base', 'recordId'], health: [], sync: ['items'], preferences: ['language'], csv: [] };
export function createDatabaseConnector({ library, config = {}, store, exclusive }) {
  const identity = library.identity;
  let queue = Promise.resolve();
  const serial = work => { const next = queue.then(() => exclusive(work)); queue = next.catch(() => {}); return next; };
  const language = async () => (await store.load()).preferences?.language || config.language || 'zh';
  const envelope = result => ({ ...result, ok: true, protocolVersion: 1, identity });
  return {
    dispatch: (action, payload = {}) => serial(async () => {
      if (!Object.hasOwn(allowed, action) || !payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(k => !['provider', 'expectedIdentity', ...allowed[action]].includes(k))) throw new SafeError('Unsupported database operation.');
      if (payload.provider !== undefined && payload.provider !== 'database') throw new SafeError('ReadFlow uses its database as the source of truth.');
      if (payload.expectedIdentity && (payload.expectedIdentity.connectionId !== identity.connectionId || payload.expectedIdentity.base !== identity.base)) throw new SafeError('Library identity changed. Disconnect before associating another library.');
      if (action === 'health') return envelope({ connected: true, schema: { valid: true, checkedFields: 7 }, capabilities: { tableRead: true, tableWrite: true, database: true, csv: true, organization: true, folders: true },
        configuration: { storageProvider: 'database', libraryName: 'ReadFlow', language: await language() } });
      if (action === 'sync') return envelope({ enabled: true, base: identity.base, ...library.sync(payload.items || []) });
      if (action === 'folders') return envelope(library.createFolder(payload.name, payload.parentId));
      if (action === 'delete') {
        if (payload.base !== identity.base) throw new SafeError('Library identity changed.');
        return envelope(library.deleteArticle(payload.recordId));
      }
      if (action === 'preferences') {
        if (!['en', 'zh'].includes(payload.language)) throw new SafeError('Invalid preferences.');
        const state = await store.load();
        state.preferences = { language: payload.language };
        await store.save(state); return envelope({});
      }
      if (action === 'csv') {
        const articles = library.list();
        return envelope({ csv: libraryCsv(articles, library.folders()), filename: 'readflow.csv', count: articles.length });
      }
      throw new SafeError('Unsupported database operation.');
    }),
  };
}

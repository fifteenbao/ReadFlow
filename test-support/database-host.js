import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileState } from '../server/file-state.js';
import { openLibrary } from '../server/database.js';
import { createHost } from '../server/host.js';

export const TEST_BASE_URL = 'https://connection.example.com/readflow/';
export const TEST_EXTENSION_ID = 'a'.repeat(32);

/** Offline SQLite host for Chrome library / pairing tests. No Feishu Bitable. */
export async function databaseHost(t, {
  baseUrl = TEST_BASE_URL,
  extensionId = TEST_EXTENSION_ID,
  connector = {},
  feishuInbox,
  now,
} = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'readflow-db-host-'));
  const config = {
    baseUrl,
    extensionId,
    stateDir: join(dir, 'state'),
    connector: { storageProvider: 'database', ...connector },
    ...(feishuInbox ? { feishuInbox, feishu: { appId: 'cli_Test' } } : {}),
  };
  const persistence = await createFileState({ ...config, authentication: 'paired' });
  await persistence.initialize();
  (await openLibrary(config.stateDir, { initialize: true, ...(now ? { now } : {}) })).close();
  const host = await createHost(config, {
    getCredentials: () => ({ appId: 'cli_Test', appSecret: 'test_secret' }),
    getEventCredentials: () => ({ encryptKey: 'test-event-encryption', verificationToken: 'test-verification-token' }),
    onDiagnostic: () => {},
  });
  t.after(async () => { host.close(); await rm(dir, { recursive: true, force: true }); });
  return { dir, config, host, library: host.library, connector: host.connector, pairing: host.pairing, handleRequest: host.handleRequest };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileState } from '../server/file-state.js';
import { DiagnosticError } from '../src/lib/diagnostics.js';

async function stateDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'readflow-lock-'));
  await chmod(dir, 0o700);
  t.after(async () => { try { const { rm } = await import('node:fs/promises'); await rm(dir, { recursive: true, force: true }); } catch {} });
  return dir;
}

test('exclusive reclaims a lock left by a dead pid and still blocks a live owner', async t => {
  const dir = await stateDir(t);
  const persistence = await createFileState({ stateDir: dir, authentication: 'paired' });
  await persistence.initialize();
  const lockPath = join(dir, 'state.lock');
  await writeFile(lockPath, JSON.stringify({ pid: 1_000_000_001, startedAt: new Date().toISOString() }), { mode: 0o600 });
  assert.equal(await persistence.exclusive(async () => 'ok'), 'ok');

  let release;
  const held = new Promise(resolve => { release = resolve; });
  const first = persistence.exclusive(async () => { release(); await new Promise(r => setTimeout(r, 50)); return 'first'; });
  await held;
  await assert.rejects(persistence.exclusive(async () => 'second'), error => error instanceof DiagnosticError && error.diagnostic.code === 'LOCK_BUSY');
  assert.equal(await first, 'first');
});

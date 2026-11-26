// Explicit commands; ingest may have external effects.
import { loadEnvFile } from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { loadHostConfig, createHost } from './host.js';
import { createFileState } from './file-state.js';
import { openLibrary } from './database.js';
import { SafeError, safeErrorMessage } from '../src/lib/security.js';
import { cleanDiagnostic, DiagnosticError } from '../src/lib/diagnostics.js';
const usage = 'Agent approval uses the same pair commands with an agent- prefix. Usage: node server/run.mjs init|audit|inbox-pending|inbox-resolve|ingest|check|pair-list|pair-approve|pair-wait|pair-reject|pair-revoke private/host.json [--env private/host.env] [--pair-id ID --fingerprint HEX] [--timeout SECONDS] [--receipt-id ID --outcome sent|not-sent]';

async function waitForAuthentication(pairing, pairId, seconds) {
  const deadline = performance.now() + seconds * 1000;
  do {
    try {
      const result = await pairing.manage('status', pairId);
      if (result.lastSeenAt != null) return { ...result, status: 'authenticated' };
    } catch (error) {
      if (error.diagnostic?.code !== 'LOCK_BUSY') throw error;
    }
    const remaining = deadline - performance.now();
    if (remaining <= 0) break;
    await delay(Math.min(1000, remaining));
  } while (true);
  throw new DiagnosticError('PAIR_WAIT_TIMEOUT', 'identity');
}
try {
  const [inputCommand, file, ...options] = process.argv.slice(2);
  const agent = inputCommand?.startsWith('agent-pair-');
  const command = agent ? inputCommand.slice(6) : inputCommand;
  if (!['init', 'audit', 'inbox-pending', 'inbox-resolve', 'pair-list', 'pair-approve', 'pair-wait', 'pair-reject', 'pair-revoke', 'ingest', 'check'].includes(command) || !file) throw new SafeError(usage);
  let envFile, pairId, fingerprint, receiptId, outcome, waitSeconds;
  for (let i = 0; i < options.length; i++) {
    if (options[i] === '--env' && options[i + 1] && !envFile) envFile = options[++i];
    else if (options[i] === '--pair-id' && options[i + 1] && !pairId) pairId = options[++i];
    else if (options[i] === '--fingerprint' && options[i + 1] && !fingerprint) fingerprint = options[++i];
    else if (options[i] === '--timeout' && command === 'pair-wait' && waitSeconds === undefined) {
      const seconds = options[++i];
      if (!/^\d{1,3}$/.test(seconds || '') || Number(seconds) < 1 || Number(seconds) > 600) throw new SafeError('Use a pair-wait timeout of 1–600 seconds.');
      waitSeconds = Number(seconds);
    }
    else if (options[i] === '--receipt-id') receiptId = options[++i];
    else if (options[i] === '--outcome') outcome = options[++i];
    else throw new SafeError(usage);
  }
  if (command === 'inbox-resolve' && (!receiptId || !['sent', 'not-sent'].includes(outcome))) throw new SafeError(usage);
  if (envFile) {
    try { loadEnvFile(envFile); } catch { throw new SafeError('Cannot load the selected environment file. Check its path and permissions.'); }
  }
  const config = await loadHostConfig(file);
  if (command === 'init' || command === 'audit') {
    try {
      const persistence = await createFileState({ ...config, authentication: 'paired' });
      if (command === 'init') await persistence.initialize();
      const library = await persistence.exclusive(() => openLibrary(config.stateDir, { initialize: command === 'init' }));
      library.close();
      console.log(JSON.stringify(await persistence.exclusive(() => persistence.audit())));
      if (command === 'init') {
        const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";
        console.log('Next, check the database connection: node server/run.mjs check ' + quote(file) + (envFile ? ' --env ' + quote(envFile) : ''));
        console.log('Feishu credentials are optional until enabling messages. Browser connections use fingerprint approval; no access key needs to be copied.');
      }
    } catch { throw new SafeError('State setup/audit failed. Check stateDir ownership, 0700 directory, 0600 regular files, nlink=1, valid JSON/key, free disk space and state.lock. Existing files were not reset.'); }
  } else {
    const host = await createHost(config);
    const selected = { connector: host.connector };
    if (command === 'inbox-pending' || command === 'inbox-resolve') {
      if (!host.inbox) throw new SafeError('Feishu inbox is disabled.');
      console.log(JSON.stringify(await host.inbox.receipts(command === 'inbox-resolve' ? receiptId : undefined, outcome))); host.close(); process.exit(0);
    }
    if (command === 'ingest') {
      const intake = host.inbox ? await host.inbox.processPending() : { ok: true, skipped: true };
      if (command === 'ingest') { console.log(JSON.stringify(intake)); host.close(); process.exit(0); }
    }
    try {
      const pairing = agent ? host.agentPairing : host.pairing;
      const result = command === 'pair-wait' ? await waitForAuthentication(pairing, pairId, waitSeconds ?? 90)
        : command.startsWith('pair-') ? await pairing.manage(command.slice(5), pairId, fingerprint)
          : await selected.connector.dispatch('health');
      console.log(JSON.stringify(command === 'check' ? { ok: result.ok, capabilities: result.capabilities } : result));
    } finally { host.close(); }
  }
} catch (error) {
  const diagnostic = cleanDiagnostic(error?.diagnostic);
  if (diagnostic) console.error(JSON.stringify(diagnostic));
  console.error(safeErrorMessage(error)); process.exitCode = 1;
}

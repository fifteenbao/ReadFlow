import { SafeError } from './security.js';
export const messages = Object.freeze({
  PAIR_REQUIRED: 'Browser pairing is missing, revoked or invalid. Pair again and ask the operator to confirm the fingerprint.',
  EXTENSION_ID_UNSET: 'Register this Chrome extension ID in host.json and restart ReadFlow.',
  PAIR_EXPIRED: 'Pairing request expired or is no longer pending. Ask the user to get a fresh request.',
  FINGERPRINT_MISMATCH: 'The full fingerprint does not match. Compare it with the current browser request before approving.',
  DEVICE_LIMIT: 'The approved-device limit of 16 is reached. List devices and explicitly revoke one you no longer use before retrying.',
  PAIR_NOT_FOUND: 'Pairing request was not found in this service configuration. Check the service address and pairing ID.',
  PAIR_WAIT_TIMEOUT: 'No successful signed request arrived before the timeout. Ask the user to keep Settings open and check the service URL, network and device clock.',
  PAIR_QUEUE_FULL: 'The pending pairing queue is full. Review the active requests, reject one if appropriate, or wait for expiry.',
  CLOCK_SKEW: 'The signed request timestamp is outside the 60-second window. Sync the device and server clocks, then retry.',
  KEY_INVALID: 'The connection access key is missing, invalid or revoked (401).',
  ORIGIN_DENIED: 'The extension origin is not registered on this connection (403).',
  ACCESS_KEY: 'Missing or invalid access.key. Initialize private state and check file ownership and permissions.',
  AUTH_VERIFY: 'Connection authorization could not be verified.',
  API_TRANSPORT: 'Provider request failed. Check network access and current credentials.',
  API_REJECTED: 'The provider rejected the operation. Check its numeric error code, permissions and field values.',
  API_RESPONSE: 'The connection adapter returned an invalid response.',
  STATE_LOAD: 'Cannot load valid connection state. Check stateDir, ownership and file contents.',
  STATE_SAVE: 'Cannot persist connection state. Check disk space and write permissions.',
  LOCK_BUSY: 'State lock is held by a running process. Retry shortly.',
  OPERATION_FAILED: 'Connection operation failed. Check the failure stage and reference.',
});
const stages = new Set(['identity', 'messages.send', 'state.load', 'state.save', 'lock', 'health', 'sync', 'read', 'preferences', 'inbox']);
export function cleanDiagnostic(value) {
  if (!value || !Object.hasOwn(messages, value.code) || typeof value.stage !== 'string') return null;
  const stage = value.stage.replace(/^(health|sync|read|preferences|inbox)\./, '');
  if (!stages.has(stage) && !stages.has(value.stage)) return null;
  const result = { code: value.code, stage: value.stage };
  if (Number.isSafeInteger(value.providerCode)) result.providerCode = value.providerCode;
  if (Number.isInteger(value.httpStatus) && value.httpStatus >= 100 && value.httpStatus <= 599) result.httpStatus = value.httpStatus;
  if (typeof value.reference === 'string' && /^[a-f0-9-]{36}$/.test(value.reference)) result.reference = value.reference;
  if (value.code === 'CLOCK_SKEW' && Number.isSafeInteger(value.serverTime) && value.serverTime > 0 && value.serverTime <= 8640000000000000) result.serverTime = value.serverTime;
  return result;
}
export class DiagnosticError extends SafeError {
  constructor(code, stage, details = {}) {
    const diagnostic = cleanDiagnostic({ ...details, code, stage });
    super(formatDiagnostic(diagnostic));
    this.diagnostic = diagnostic;
  }
}
export function formatDiagnostic(value) {
  const d = cleanDiagnostic(value);
  if (!d) return messages.OPERATION_FAILED;
  return `${messages[d.code]} [${d.code}; ${d.stage}${d.providerCode !== undefined ? `; provider=${d.providerCode}` : ''}${d.httpStatus ? `; HTTP=${d.httpStatus}` : ''}${d.reference ? `; ref=${d.reference}` : ''}${d.serverTime ? `; serverTime=${new Date(d.serverTime).toISOString()}` : ''}]`;
}

// Reference server-side approval and durable signature replay protection.
import { createPublicKey, verify, createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { DiagnosticError } from '../src/lib/diagnostics.js';
import { SafeError } from '../src/lib/security.js';
import { parseConnectionUrl } from '../src/lib/connection-url.js';
import { displayPairingFingerprint } from '../src/lib/pairing-fingerprint.js';
const uuid = value => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value || '');
function normalized(key) {
  if (!key || Object.keys(key).sort().join() !== 'crv,kty,x,y' || key.kty !== 'EC' || key.crv !== 'P-256' || !/^[A-Za-z0-9_-]{43}$/.test(key.x || '') || !/^[A-Za-z0-9_-]{43}$/.test(key.y || '')) throw new SafeError('Invalid pairing public key.');
  const result = { kty: 'EC', crv: 'P-256', x: key.x, y: key.y }; createPublicKey({ key: result, format: 'jwk' }); return result;
}
const fingerprint = key => createHash('sha256').update(JSON.stringify(key)).digest('hex');
const pairingSummary = (pairId, request) => ({
  pairId, endpoint: request.endpoint, extensionId: request.extensionId, fingerprint: request.fingerprint,
  fingerprintCode: displayPairingFingerprint(request.fingerprint)?.code,
});
const approvedSummary = (pairId, key) => ({
  ...pairingSummary(pairId, key), approvedAt: key.approvedAt,
  lastSeenAt: key.lastSeenAt ?? null, lastUsedIp: key.lastUsedIp ?? null,
});
export function createPairing({ config, store, exclusive, now = () => Date.now(), agent = false }) {
  const target = parseConnectionUrl(config.baseUrl), origin = `chrome-extension://${config.extensionId}`;
  const slot = agent ? 'agentPairing' : 'pairing';
  const stateOf = state => state[slot] ||= { requests: {}, keys: {}, nonces: {} };
  function matching(request) { return request.extensionId === (agent ? 'agent' : config.extensionId) && request.endpoint === target.baseUrl; }
  return {
    request: body => exclusive(async () => {
      if (!agent && !config.extensionId) throw new DiagnosticError('EXTENSION_ID_UNSET', 'identity');
      if (!body || Object.keys(body).join() !== 'publicKey') throw new SafeError('Invalid pairing request.');
      const publicKey = normalized(body.publicKey), fp = fingerprint(publicKey), state = await store.load(), pairing = stateOf(state);
      for (const [pairId, key] of Object.entries(pairing.keys)) if (matching(key) && key.fingerprint === fp) return { ok: true, pairId, fingerprint: fp, status: 'approved' };
      const at = now();
      for (const [id, request] of Object.entries(pairing.requests)) if (request.expiresAt <= at) delete pairing.requests[id];
      for (const [pairId, request] of Object.entries(pairing.requests)) if (matching(request) && request.fingerprint === fp) return { ok: true, pairId, fingerprint: fp, status: 'pending' };
      if (Object.keys(pairing.requests).length >= 3) throw new DiagnosticError('PAIR_QUEUE_FULL', 'identity');
      const pairId = randomUUID(); pairing.requests[pairId] = { publicKey, fingerprint: fp, endpoint: target.baseUrl, extensionId: agent ? 'agent' : config.extensionId, createdAt: at, expiresAt: at + 10 * 60000 };
      await store.save(state); return { ok: true, pairId, fingerprint: fp, status: 'pending' };
    }),
    manage: (action, pairId, expectedFingerprint) => exclusive(async () => {
      const state = await store.load(), pairing = stateOf(state);
      const at = now();
      if (action === 'list') {
        const requests = Object.entries(pairing.requests).map(([id, request]) => ({ ...pairingSummary(id, request), expiresAt: request.expiresAt }));
        return { ok: true, endpoint: target.baseUrl,
          pending: requests.filter(request => request.expiresAt > at),
          expired: requests.filter(request => request.expiresAt <= at).map(request => ({ ...request, expired: true })),
          approved: Object.entries(pairing.keys).map(([id, key]) => approvedSummary(id, key)),
        };
      }
      if (!uuid(pairId)) throw new SafeError('Choose one valid pairing request ID.');
      if (action === 'status') {
        const key = pairing.keys[pairId], request = pairing.requests[pairId];
        if (key && matching(key)) return { ok: true, status: 'approved', ...approvedSummary(pairId, key) };
        if (!request || !matching(request)) throw new DiagnosticError('PAIR_NOT_FOUND', 'identity');
        if (request.expiresAt <= at) throw new DiagnosticError('PAIR_EXPIRED', 'identity');
        return { ok: true, status: 'pending' };
      }
      if (action === 'approve') {
        const request = pairing.requests[pairId];
        if (request && !matching(request)) throw new DiagnosticError('PAIR_NOT_FOUND', 'identity');
        if (!request || request.expiresAt <= at) throw new DiagnosticError('PAIR_EXPIRED', 'identity');
        if (!/^[a-f0-9]{64}$/.test(expectedFingerprint || '') || request.fingerprint !== expectedFingerprint) throw new DiagnosticError('FINGERPRINT_MISMATCH', 'identity');
        if (Object.keys(pairing.keys).length >= 16) throw new DiagnosticError('DEVICE_LIMIT', 'identity');
        const otherApproved = agent ? [] : Object.entries(pairing.keys)
          .filter(([, key]) => matching(key)).map(([id, key]) => approvedSummary(id, key));
        const key = { ...request, approvedAt: at };
        pairing.keys[pairId] = key;
        delete pairing.requests[pairId];
        await store.save(state);
        return { ok: true, status: 'approved', ...approvedSummary(pairId, key),
          servicePath: new URL(target.baseUrl).pathname, extensionIdPrefix: key.extensionId.slice(0, 6),
          ...(otherApproved.length ? { otherApproved, nextStep: 'Ask the user whether to keep previous devices. Revoke only an explicitly selected pair ID.' } : {}),
        };
      }
      if (action === 'reject') delete pairing.requests[pairId];
      else if (action === 'revoke') delete pairing.keys[pairId];
      else throw new SafeError('Unsupported pairing management operation.');
      await store.save(state); return { ok: true };
    }),
    authenticate: async (request, { clientIp } = {}) => {
      if ((agent ? request.headers.has('Origin') : request.headers.get('Origin') !== origin || !config.extensionId) || request.method !== 'POST') return false;
      const pairId = request.headers.get('X-ReadFlow-Pair'), nonce = request.headers.get('X-ReadFlow-Nonce'), stamp = request.headers.get('X-ReadFlow-Time'), signature = request.headers.get('X-ReadFlow-Signature');
      if (!uuid(pairId) || !uuid(nonce) || !/^\d{13}$/.test(stamp || '') || !/^[A-Za-z0-9_-]{86}$/.test(signature || '')) return false;
      const url = new URL(request.url);
      if (url.origin !== target.origin || !url.pathname.startsWith(target.apiPath)) return false;
      // The HTTP handler bounds parsed JSON before authentication; hashing uses that exact body.
      const reader = request.clone().body?.getReader();
      if (!reader) return false;
      const hash = createHash('sha256'); let size = 0;
      try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 20 * 1024 * 1024) { await reader.cancel(); return false; } hash.update(value); } }
      finally { reader.releaseLock(); }
      const bodyDigest = hash.digest('hex');
      return exclusive(async () => {
        const state = await store.load(), pairing = stateOf(state), key = pairing.keys[pairId];
        if (!key || !matching(key)) return false;
        const content = ['POST', request.url, stamp, nonce, bodyDigest].join('\n');
        if (!verify('sha256', Buffer.from(content), { key: createPublicKey({ key: normalized(key.publicKey), format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url'))) return false;
        const authenticatedAt = now();
        if (Math.abs(authenticatedAt - Number(stamp)) > 60000) throw new DiagnosticError('CLOCK_SKEW', 'identity', { serverTime: authenticatedAt });
        for (const [id, expiry] of Object.entries(pairing.nonces)) if (expiry < authenticatedAt) delete pairing.nonces[id];
        const id = pairId + ':' + nonce;
        if (pairing.nonces[id] || Object.keys(pairing.nonces).length >= 10000) return false;
        pairing.nonces[id] = authenticatedAt + 120000;
        key.lastSeenAt = authenticatedAt;
        key.lastUsedIp = typeof clientIp === 'string' && !clientIp.includes('%') && isIP(clientIp) ? clientIp : null;
        await store.save(state);
        return true;
      });
    },
  };
}

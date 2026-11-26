const base32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function displayPairingFingerprint(fingerprint) {
  if (!/^[a-f0-9]{64}$/.test(fingerprint || '')) return null;
  // Four letters encode the last 20 bits for a quick visual comparison.
  const bits = Number.parseInt(fingerprint.slice(-5), 16);
  const code = [15, 10, 5, 0].map(shift => base32[(bits >> shift) & 31]).join('');
  return { groups: fingerprint.match(/.{4}/g).join(' '), code };
}

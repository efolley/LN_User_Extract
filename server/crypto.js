/* Symmetric encryption helper using AES-256-GCM. Requires MASTER_KEY env var (32 bytes hex or raw). */
const crypto = require('crypto');

const MASTER_KEY = process.env.MASTER_KEY || null;
if (!MASTER_KEY) {
  // When required, callers should ensure env var is set. Don't throw at module load to allow migrations in tests.
}

function _getKey() {
  if (!MASTER_KEY) throw new Error('MASTER_KEY not set');
  // If the key looks like hex, convert, otherwise treat as raw utf-8
  if (/^[0-9a-fA-F]+$/.test(MASTER_KEY) && MASTER_KEY.length >= 64) {
    return Buffer.from(MASTER_KEY, 'hex').slice(0, 32);
  }
  const b = Buffer.from(MASTER_KEY, 'utf8');
  if (b.length < 32) {
    const padded = Buffer.alloc(32);
    b.copy(padded);
    return padded;
  }
  return b.slice(0, 32);
}

function encrypt(plaintext) {
  const key = _getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext || '')), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decrypt(token) {
  const key = _getKey();
  const data = Buffer.from(token, 'base64');
  const iv = data.slice(0, 12);
  const tag = data.slice(12, 28);
  const encrypted = data.slice(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

module.exports = { encrypt, decrypt };

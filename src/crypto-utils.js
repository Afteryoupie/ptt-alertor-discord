'use strict';

// ─── AES-256-GCM Cookie Encryption ───────────────────────────────────────────
//
// Encrypts/decrypts user session cookies before storing them in the DB.
// The 32-byte key is read from process.env.AUTOBUY_SECRET (hex-encoded).
//
// Usage:
//   const { encryptCookie, decryptCookie } = require('./crypto-utils');
//   const enc = encryptCookie('_session_id=abc123; ...');
//   const plain = decryptCookie(enc);

const crypto = require('node:crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES   = 12; // 96-bit IV recommended for GCM
const TAG_BYTES  = 16;

/**
 * Derive the 32-byte key from the AUTOBUY_SECRET env var.
 * Throws if not set or wrong length.
 * @returns {Buffer}
 */
function getKey() {
  const secret = process.env.AUTOBUY_SECRET;
  if (!secret) {
    throw new Error('[crypto] AUTOBUY_SECRET is not set in .env');
  }
  // Accept either a 64-char hex string (32 bytes) or a raw 32-byte string
  if (/^[0-9a-fA-F]{64}$/.test(secret)) {
    return Buffer.from(secret, 'hex');
  }
  if (secret.length === 32) {
    return Buffer.from(secret, 'utf8');
  }
  throw new Error('[crypto] AUTOBUY_SECRET must be a 64-char hex string (32 bytes). Generate with: openssl rand -hex 32');
}

/**
 * Encrypt a plaintext string.
 * @param {string} plaintext
 * @returns {{ encrypted: string, iv: string, authTag: string }}  all values are hex strings
 */
function encryptCookie(plaintext) {
  const key    = getKey();
  const iv     = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  return {
    encrypted: encrypted.toString('hex'),
    iv:        iv.toString('hex'),
    authTag:   cipher.getAuthTag().toString('hex'),
  };
}

/**
 * Decrypt a previously encrypted cookie.
 * @param {{ encrypted: string, iv: string, authTag: string }} params
 * @returns {string | null}  plaintext, or null if decryption fails
 */
function decryptCookie({ encrypted, iv, authTag }) {
  try {
    const key      = getKey();
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(iv, 'hex'),
      { authTagLength: TAG_BYTES }
    );
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'hex')),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  } catch (err) {
    console.error('[crypto] decryptCookie failed:', err.message);
    return null;
  }
}

module.exports = { encryptCookie, decryptCookie };

import crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;

export function generateDek() {
  return crypto.randomBytes(32);
}

function getMasterKey() {
  const { MASTER_KEY_HEX } = process.env;
  if (!MASTER_KEY_HEX) {
    throw new Error('MASTER_KEY_HEX must be set for envelope encryption');
  }
  const buf = Buffer.from(MASTER_KEY_HEX, 'hex');
  if (buf.length !== 32) {
    throw new Error('MASTER_KEY_HEX must be 32 bytes (64 hex chars)');
  }
  return buf;
}

export function encryptWithDek(dek, plaintext) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, dek, iv, { authTagLength: 16 });
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    authTag: authTag.toString('base64')
  };
}

export function decryptWithDek(dek, { iv, ciphertext, authTag }) {
  const ivBuf = Buffer.from(iv, 'base64');
  const ctBuf = Buffer.from(ciphertext, 'base64');
  const tagBuf = Buffer.from(authTag, 'base64');
  const decipher = crypto.createDecipheriv(ALGO, dek, ivBuf, { authTagLength: 16 });
  decipher.setAuthTag(tagBuf);
  const plaintext = Buffer.concat([decipher.update(ctBuf), decipher.final()]);
  return plaintext.toString('utf8');
}

export function wrapDek(dek) {
  const master = getMasterKey();
  const { iv, ciphertext, authTag } = encryptWithDek(master, dek.toString('base64'));
  return { iv, ciphertext, authTag };
}

export function unwrapDek(wrapped) {
  const master = getMasterKey();
  const dekB64 = decryptWithDek(master, wrapped);
  return Buffer.from(dekB64, 'base64');
}


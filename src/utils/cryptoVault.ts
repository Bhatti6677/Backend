import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits
const PREFIX = 'enc:v1:';

/**
 * Derives a consistent 32-byte key from environment configuration.
 * Uses process.env.DATA_ENCRYPTION_KEY or process.env.JWT_SECRET as cryptographic seed.
 */
function getEncryptionKey(): Buffer {
  const secret =
    process.env.DATA_ENCRYPTION_KEY ||
    process.env.ADMIN_SECRET ||
    process.env.JWT_SECRET ||
    'earn-street-production-encryption-salt-2026';

  // If secret is already a 64-char hex string (32 bytes), parse directly
  if (/^[0-9a-fA-F]{64}$/.test(secret)) {
    return Buffer.from(secret, 'hex');
  }

  // Otherwise deterministically derive 32 bytes using SHA-256
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Produces: enc:v1:<iv_hex>:<auth_tag_hex>:<ciphertext_hex>
 */
export function encryptData(plaintext: string): string {
  if (!plaintext || typeof plaintext !== 'string') return plaintext;

  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return `${PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  } catch (err) {
    console.error('CryptoVault encryption error:', err);
    return plaintext;
  }
}

/**
 * Decrypts an AES-256-GCM payload.
 * If the string does not have the 'enc:v1:' prefix, it is treated as existing plaintext
 * and returned unmodified (ensuring 100% backward compatibility with legacy DB records).
 */
export function decryptData(ciphertext: string): string {
  if (!ciphertext || typeof ciphertext !== 'string' || !ciphertext.startsWith(PREFIX)) {
    return ciphertext;
  }

  try {
    const payload = ciphertext.slice(PREFIX.length);
    const parts = payload.split(':');
    if (parts.length !== 3) return ciphertext;

    const [ivHex, authTagHex, encryptedHex] = parts;
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (err) {
    console.error('CryptoVault decryption error:', err);
    return ciphertext;
  }
}

/**
 * Helper to mask recipient account numbers (e.g., 03001234567 -> 0300****567)
 */
export function maskAccount(account: string): string {
  if (!account || typeof account !== 'string') return '';
  const trimmed = account.trim();
  if (trimmed.length <= 4) return '****';
  const visibleStart = Math.min(4, Math.floor(trimmed.length / 3));
  const visibleEnd = Math.min(3, Math.floor(trimmed.length / 3));
  const maskedLength = Math.max(2, trimmed.length - visibleStart - visibleEnd);
  return `${trimmed.slice(0, visibleStart)}${'*'.repeat(maskedLength)}${trimmed.slice(-visibleEnd)}`;
}

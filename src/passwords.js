import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing for the mock accounts.
 *
 * Not a production identity system - the accounts are seeded and the password
 * is public - but the credentials are not stored in plaintext, and the
 * comparison is timing-safe.
 */

const KEY_LENGTH = 64;
const SALT_BYTES = 16;

// scrypt parameters. maxmem is raised because N=16384, r=8 needs more than
// node's default 32 MB.
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/**
 * @param {string} password
 * @param {string} [salt] hex salt; generated when omitted
 * @returns {{ hash: string, salt: string }}
 */
export function hashPassword(password, salt = randomBytes(SALT_BYTES).toString('hex')) {
  const derived = scryptSync(password, salt, KEY_LENGTH, SCRYPT_PARAMS);
  return { hash: derived.toString('hex'), salt };
}

/**
 * @param {string} password the candidate
 * @param {string} hash the stored hex hash
 * @param {string} salt the stored hex salt
 * @returns {boolean}
 */
export function verifyPassword(password, hash, salt) {
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(password, salt, KEY_LENGTH, SCRYPT_PARAMS);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

import {
  randomBytes,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto'

/**
 * `promisify(scrypt)` loses the four-argument overload in TypeScript, so the
 * callback form is wrapped explicitly. Runtime behaviour is identical.
 */
function scryptAsync(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derived) => {
      if (error) {
        reject(error)
        return
      }
      resolve(derived)
    })
  })
}

const SCRYPT_N = 16_384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LENGTH = 64
const SALT_BYTES = 16

/**
 * Password hashing with Node's built-in scrypt. No password ever leaves the
 * process in plaintext, and verification uses a constant-time comparison.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const derived = (await scryptAsync(password.normalize('NFKC'), salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  })) as Buffer
  return [
    'scrypt',
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$')
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false
  }
  const n = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) {
    return false
  }
  let salt: Buffer
  let expected: Buffer
  try {
    salt = Buffer.from(parts[4]!, 'base64url')
    expected = Buffer.from(parts[5]!, 'base64url')
  } catch {
    return false
  }
  if (expected.length === 0) {
    return false
  }
  const derived = (await scryptAsync(password.normalize('NFKC'), salt, expected.length, {
    N: Math.min(n, 1 << 20),
    r,
    p,
    maxmem: 128 * 1024 * 1024,
  })) as Buffer
  return derived.length === expected.length && timingSafeEqual(derived, expected)
}

/**
 * A fixed-cost verification target for unknown accounts, so a missing email
 * does not answer measurably faster than a wrong password.
 */
export const DUMMY_PASSWORD_HASH =
  'scrypt$16384$8$1$MDEyMzQ1Njc4OWFiY2RlZg$' +
  '91N6IibOCNGoJIaLSVpuW8f6Qg4lxDxxq0yCck7RYgnoDkMSGEYhoP9aqNjR08hwW6OkhlITEQoD_Hoq0k5wxQ'

export function passwordProblem(password: string): string | null {
  if (password.length < 10) {
    return 'Use at least 10 characters for the password.'
  }
  if (password.length > 200) {
    return 'The password is longer than 200 characters.'
  }
  if (password.trim().length === 0) {
    return 'The password cannot be empty or whitespace only.'
  }
  return null
}

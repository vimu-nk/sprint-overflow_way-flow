import sharp from 'sharp';
import { SignJWT } from 'jose';
import { describe, expect, it, vi } from 'vitest';
import { reencode, sniffImage } from '../../src/attachments/image.js';
import { ARGON2_PARAMS, hashPassword, needsRehash, passwordPolicyError, verifyPassword } from '../../src/auth/passwords.js';
import { csrfTokenFor, hashRefreshToken, newRefreshToken, signAccess, verifyAccess } from '../../src/auth/tokens.js';
import { originAllowed } from '../../src/auth/guards.js';

describe('SEC-01…06 passwords', () => {
  it('hashes with Argon2id and the configured parameters, unique salt per hash', async () => {
    const a = await hashPassword('correct horse battery staple');
    const b = await hashPassword('correct horse battery staple');
    expect(a).toMatch(new RegExp(`^\\$argon2id\\$v=19\\$m=${ARGON2_PARAMS.memoryCost},t=${ARGON2_PARAMS.timeCost},p=1\\$`));
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, 'correct horse battery staple')).toBe(true);
    expect(await verifyPassword(a, 'wrong')).toBe(false);
  });

  it('flags weaker stored hashes for rehash on login (SEC-04)', () => {
    expect(needsRehash('$argon2id$v=19$m=19456,t=2,p=1$abc$def')).toBe(true);
    expect(needsRehash(`$argon2id$v=19$m=${ARGON2_PARAMS.memoryCost},t=1,p=1$abc$def`)).toBe(false);
    expect(needsRehash('$2b$10$bcrypt')).toBe(true);
  });

  it('applies the NIST-style policy (SEC-05)', () => {
    expect(passwordPolicyError('short')).toMatch(/12/);
    expect(passwordPolicyError('unbelievable')).toMatch(/common/);
    expect(passwordPolicyError('ලංකාව delivery 2026')).toBeNull();
    expect(passwordPolicyError('x'.repeat(129))).toMatch(/128/);
  });
});

describe('SEC-10…17 tokens and CSRF', () => {
  it('signs and verifies access tokens', async () => {
    const t = await signAccess('11111111-1111-1111-1111-111111111111', 'driver', 'sid-1');
    expect(await verifyAccess(t)).toMatchObject({ sub: '11111111-1111-1111-1111-111111111111', role: 'driver', sid: 'sid-1' });
  });

  it('rejects alg=none, a wrong key and a wrong audience', async () => {
    const none = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: 'x', role: 'dispatcher', sid: 's', aud: 'wayflow-web', iss: 'wayflow-api' })).toString('base64url')}.`;
    expect(await verifyAccess(none)).toBeNull();
    const wrongKey = await new SignJWT({ role: 'dispatcher', sid: 's' }).setProtectedHeader({ alg: 'HS256' }).setSubject('x').setIssuer('wayflow-api').setAudience('wayflow-web').setExpirationTime('5m').sign(new TextEncoder().encode('another-secret-another-secret-123456'));
    expect(await verifyAccess(wrongKey)).toBeNull();
    const wrongAud = await new SignJWT({ role: 'dispatcher', sid: 's' }).setProtectedHeader({ alg: 'HS256' }).setSubject('x').setIssuer('wayflow-api').setAudience('other').setExpirationTime('5m').sign(new TextEncoder().encode(process.env.JWT_SECRET!));
    expect(await verifyAccess(wrongAud)).toBeNull();
  });

  it('rejects expired tokens', async () => {
    const old = await new SignJWT({ role: 'dispatcher', sid: 's' }).setProtectedHeader({ alg: 'HS256' }).setSubject('x').setIssuer('wayflow-api').setAudience('wayflow-web').setIssuedAt(1000).setExpirationTime(2000).sign(new TextEncoder().encode(process.env.JWT_SECRET!));
    expect(await verifyAccess(old)).toBeNull();
  });

  it('refresh tokens are 256-bit and stored only as a keyed hash', () => {
    const t = newRefreshToken();
    expect(Buffer.from(t, 'base64url')).toHaveLength(32);
    expect(hashRefreshToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRefreshToken(t)).not.toContain(t);
  });

  it('CSRF tokens are bound to the session', () => {
    expect(csrfTokenFor('a')).toBe(csrfTokenFor('a'));
    expect(csrfTokenFor('a')).not.toBe(csrfTokenFor('b'));
  });

  it('origin check accepts allow-listed and same-host origins only', () => {
    const req = (h: Record<string, string>) => ({ headers: { host: 'localhost:8080', ...h } }) as never;
    expect(originAllowed(req({ origin: 'http://localhost:8080' }))).toBe(true);
    expect(originAllowed(req({ origin: 'https://evil.example' }))).toBe(false);
    expect(originAllowed(req({ referer: 'https://evil.example/x' }))).toBe(false);
    expect(originAllowed(req({ 'sec-fetch-site': 'cross-site' }))).toBe(false);
  });
});

describe('SEC-38 uploads', () => {
  it('detects real image types from magic bytes', async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#174d3a' } }).png().toBuffer();
    expect(sniffImage(png)).toBe('png');
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffImage(Buffer.from('<html><script>alert(1)</script>'))).toBeNull();
    expect(sniffImage(Buffer.from('%PDF-1.7'))).toBeNull();
  });

  it('re-encoding strips EXIF (including GPS) and appended payloads', async () => {
    const withExif = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#ffffff' } })
      .jpeg()
      .withExif({ IFD0: { Make: 'TestCam', Copyright: 'secret-gps-note' } })
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const polyglot = Buffer.concat([withExif, Buffer.from('<script>alert(1)</script>')]);
    const clean = await reencode(polyglot);
    expect((await sharp(clean).metadata()).exif).toBeUndefined();
    expect(clean.includes(Buffer.from('<script>'))).toBe(false);
    expect(clean.includes(Buffer.from('secret-gps-note'))).toBe(false);
  });
});

describe('SEC-58 production configuration', () => {
  it('refuses to start in production with example secrets', async () => {
    vi.resetModules();
    const saved = { ...process.env };
    Object.assign(process.env, {
      NODE_ENV: 'production',
      JWT_SECRET: 'dev-only-jwt-secret-change-me-0123456789abcdef',
      REFRESH_TOKEN_PEPPER: 'dev-only-refresh-pepper-change-me-0123456789ab',
      CSRF_SECRET: 'dev-only-csrf-secret-change-me-0123456789abcdef',
      SEED_DEFAULT_PASSWORD: 'Waypoint-Demo-2026!',
      COOKIE_SECURE: 'false',
    });
    await expect(import('../../src/env.js')).rejects.toThrow(/Refusing to start in production/);
    process.env = saved;
  });

  it('starts in production with strong, distinct secrets and HTTPS cookies', async () => {
    vi.resetModules();
    const saved = { ...process.env };
    Object.assign(process.env, {
      NODE_ENV: 'production',
      JWT_SECRET: 'a'.repeat(20) + 'jwt-strong-secret-xyz',
      REFRESH_TOKEN_PEPPER: 'b'.repeat(20) + 'pepper-strong-secret-xyz',
      CSRF_SECRET: 'c'.repeat(20) + 'csrf-strong-secret-xyz',
      SEED_DEFAULT_PASSWORD: 'a-unique-demo-password-2026',
      S3_SECRET_KEY: 'a-real-s3-secret-value',
      COOKIE_SECURE: 'true',
      CORS_ORIGINS: 'https://wayflow.example',
    });
    const mod = await import('../../src/env.js');
    expect(mod.isProd).toBe(true);
    process.env = saved;
  });
});

import { z } from 'zod';

// Host dev: load the repo-root .env. In containers there is no file and compose env applies.
try {
  process.loadEnvFile(new URL('../../../.env', import.meta.url));
} catch {
  // no .env
}

const EXAMPLE_SECRETS = new Set([
  'change-me',
  'change-me-generate-with-openssl-rand-base64-48',
  'dev-only-jwt-secret-change-me-0123456789abcdef',
  'dev-only-refresh-pepper-change-me-0123456789ab',
  'dev-only-csrf-secret-change-me-0123456789abcdef',
]);
const EXAMPLE_PASSWORDS = new Set(['Waypoint-Demo-2026!', 'change-me-min-12-chars']);

const bool = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().url(),
  /** Least-privilege runtime role (SEC-60). Falls back to DATABASE_URL in dev. */
  APP_DATABASE_URL: z.string().url().optional(),
  APP_DB_PASSWORD: z.string().min(8).optional(),
  VALKEY_URL: z.string().default('redis://localhost:6379'),
  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().default('wayflow-app'),
  S3_SECRET_KEY: z.string().default('wayflow-app-secret'),
  S3_BUCKET: z.string().default('pod'),
  PLANNER_URL: z.string().url().default('http://localhost:8000'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  REFRESH_TOKEN_PEPPER: z.string().min(32, 'REFRESH_TOKEN_PEPPER must be at least 32 characters'),
  CSRF_SECRET: z.string().min(32, 'CSRF_SECRET must be at least 32 characters'),
  COOKIE_SECURE: bool,
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:8080'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(3).default(1),
  ENABLE_DEMO_TOOLS: bool,
  ENABLE_API_DOCS: bool,
  SEED_DEFAULT_PASSWORD: z.string().min(12, 'SEED_DEFAULT_PASSWORD must be at least 12 characters'),
  APP_SIMULATION_DATE: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .default('2026-05-19'),
  APP_SIMULATION_TIME: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .default('14:00'),
  DATA_DIR: z.string().default('../../data/source'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  const env = parsed.data;
  // SEC-58: production refuses weak or example values.
  if (env.NODE_ENV === 'production') {
    const problems: string[] = [];
    for (const k of ['JWT_SECRET', 'REFRESH_TOKEN_PEPPER', 'CSRF_SECRET'] as const) {
      if (EXAMPLE_SECRETS.has(env[k])) problems.push(`${k} uses the example value`);
    }
    if (new Set([env.JWT_SECRET, env.REFRESH_TOKEN_PEPPER, env.CSRF_SECRET]).size < 3)
      problems.push('JWT_SECRET, REFRESH_TOKEN_PEPPER and CSRF_SECRET must differ');
    if (EXAMPLE_PASSWORDS.has(env.SEED_DEFAULT_PASSWORD)) problems.push('SEED_DEFAULT_PASSWORD uses the example value');
    if (env.S3_SECRET_KEY === 'wayflow-app-secret') problems.push('S3_SECRET_KEY uses the example value');
    if (!env.COOKIE_SECURE) problems.push('COOKIE_SECURE must be true');
    if (/\*|localhost|127\.0\.0\.1/.test(env.CORS_ORIGINS)) problems.push('CORS_ORIGINS must not contain * or localhost');
    if (problems.length) {
      throw new Error(`Refusing to start in production:\n  ${problems.join('\n  ')}`);
    }
  }
  return env;
}

export const env = load();
export const isProd = env.NODE_ENV === 'production';

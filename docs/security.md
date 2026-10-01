# Security

Target: OWASP ASVS Level 2-aligned controls from [specs/19](../specs/19-security-requirements.md). This page states what is implemented, where, how it is tested, and what is not done yet.

## Scope and assumptions

- Four roles with seeded demo accounts; no self-registration (SEC-09).
- The competition data is confidential: every data route requires a session, there is no bulk export, and pages are `noindex`.
- Local stack runs over HTTP on localhost; any shared deployment must use HTTPS and `NODE_ENV=production` (the API refuses to start otherwise).

## Threat model

| Asset | Threats | Main controls |
| --- | --- | --- |
| Accounts and sessions | Credential stuffing, token theft, CSRF, session fixation, refresh replay | Argon2id, generic errors + dummy verify, IP + account throttling, httpOnly cookies, rotating refresh tokens with reuse detection, CSRF token + Origin check, new session per login |
| Plans and orders | Wrong role changing state, IDOR, replayed offline actions | Deny-by-default guards, role decorators, scope in every query (404 for others' objects), transition tables, per-user idempotency ledger, server-side re-authorisation of every queued action |
| Proof-of-delivery photos | Malicious upload, disclosure, location leak | Magic-byte check, size cap, `sharp` re-encode (drops EXIF/GPS and appended payloads), server-generated keys, private bucket, authorised proxied reads |
| Competition datasets | Scraping, indexing | Authenticated routes only, no export, `robots.txt Disallow: /`, `X-Robots-Tag`, API docs off outside dev |
| Availability | Hash CPU DoS, slow requests, upload floods | Throttling (global, login, refresh, uploads, sync), body limits, request and header timeouts, SSE connection cap |
| Secrets | Leak via git, logs, images | `.env` ignored, gitleaks in CI, log redaction, production refuses example values, secrets via env only |
| Supply chain | Vulnerable dependencies or images | Lockfile + `--frozen-lockfile`, `pnpm audit --prod`, Trivy in CI, minimal non-root images |

## Authentication and sessions

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant A as API
  participant D as DB
  B->>A: POST /auth/login (Origin checked)
  A->>A: throttle check (IP + account)
  A->>D: load user; Argon2id verify (dummy verify if unknown)
  A->>D: new refresh family; cap 5 sessions per user
  A-->>B: Set-Cookie access (15 min, HttpOnly, Lax), refresh (HttpOnly, Strict, Path=/api/v1/auth), csrf (readable)
  B->>A: any request (cookie) → AuthGuard reloads user + checks family not revoked
  B->>A: POST /auth/refresh (X-CSRF-Token bound to the family)
  A->>D: mark old token used, insert new one in the same family
  alt old token presented again after the 10 s grace
    A->>D: revoke the whole family, audit security.refresh_token_reuse
    A-->>B: 401
  end
  B->>A: POST /auth/logout → family revoked, cookies cleared, client keeps unsynced outbox
```

Lifetimes (SEC-14): access 15 min for every role; refresh idle / absolute: dispatcher 30 min / 12 h, store manager 60 min / 12 h, loader 30 min / 12 h, driver 12 h / 7 days (offline shifts). Sliding refresh never passes the absolute limit.

In production the cookies use the `__Host-` / `__Secure-` prefixes and `Secure`.

## Authorization

| Role | Dispatcher API | Store API | Loader API | Driver API | Sync | Demo tools |
| --- | --- | --- | --- | --- | --- | --- |
| Dispatcher | both depots | – | – | – | – | if enabled |
| Store manager | – | own outlet | – | – | – | – |
| Loader | – | – | own depot | – | own depot's trips | – |
| Driver | – | – | – | own vehicle | own vehicle's trips | – |

`–` = 403. Objects outside the scope return 404 (no existence leak). Every route is authenticated unless on a five-route allow-list (login, refresh, logout, health, ready), enforced by a test.

## Controls → code → tests

| ID | Control | Code | Test |
| --- | --- | --- | --- |
| SEC-01/02 | Argon2id 46 MiB/1/1, unique salt, hash never returned | `auth/passwords.ts`, response DTOs | unit `SEC-01…06 passwords › hashes with Argon2id…`; integration `never returns password or token hashes` |
| SEC-04 | Rehash on login when params are weaker | `AuthService.login`, `needsRehash` | unit `flags weaker stored hashes…` |
| SEC-05 | 12–128 chars, any characters, 10k common-password list | `passwordPolicyError` | unit `applies the NIST-style policy` |
| SEC-06 | Same error and work for unknown user | `dummyVerify` | integration rate-limit suite (generic 401/429) |
| SEC-07 | Password change needs current password, revokes other sessions | `AuthService.changePassword` | manual (Profile page) |
| SEC-08 | Seed uses the same hashing; prod refuses example password | `seed/demo.ts`, `env.ts` | unit `refuses to start in production…` |
| SEC-10 | HS256 pinned, iss/aud/exp, 30 s leeway, scope from DB | `auth/tokens.ts`, `AuthGuard` | unit `rejects alg=none, a wrong key and a wrong audience`, `rejects expired tokens` |
| SEC-11/12 | 256-bit opaque refresh, keyed hash, rotation, reuse revokes family | `AuthService.refresh` | unit `refresh tokens are 256-bit…`; integration `rotates refresh tokens and revokes the family on reuse` |
| SEC-13 | HttpOnly, SameSite, refresh path-scoped, prefixes in prod | `auth.controller.ts` | integration `sets httpOnly SameSite cookies…` |
| SEC-15/16 | Logout revokes server-side; new family per login | `AuthService.logout`, `startSession` | integration `…logout revokes the session server-side` |
| SEC-17 | CSRF token bound to session + Origin allow-list on writes | `CsrfGuard`, `originAllowed` | unit `CSRF tokens are bound to the session`, `origin check…`; integration `rejects state-changing requests without the CSRF token…` |
| SEC-19 | ≤ 5 sessions, list and revoke | `startSession`, `/auth/sessions` | manual (Profile page) |
| SEC-20 | Re-enter password for demo reset and password change | `dev.controller.ts`, `changePassword` | integration setup uses it |
| SEC-25 | Deny by default, explicit `@Public` | global `APP_GUARD`s | unit `only the allow-listed routes are public` |
| SEC-26/32 | Scope in queries; 404 for others' objects; role matrix | services (`ownOrder`, `loaderTrip`, `driverTrip`, `SyncService.tripFor`) | integration `applies the role matrix`, `IDOR` suite |
| SEC-27/34 | Strict zod schemas, unknown fields rejected | `@wayflow/shared` schemas, `parse()` | integration `rejects unknown fields (mass assignment)` |
| SEC-28 | Transition tables per aggregate | `state-machines.ts` | unit `state machines` |
| SEC-29 | Explicit response DTOs | `views.service.ts` | integration `never returns password or token hashes` |
| SEC-30 | Demo tools flag-gated, dispatcher only, audited | `dev.controller.ts` | unit `role-scoped controllers declare their roles`; integration role matrix |
| SEC-31 | `?next=` only to allow-listed relative paths | `web/src/lib/session.ts safeNext` | – |
| SEC-35 | Drizzle parameters only (`sql.raw` only for the migrate job's role DDL with an env value) | all services | integration `treats SQL injection payloads as plain text` |
| SEC-36 | React escaping, no `dangerouslySetInnerHTML`, CSP | web | CSP header check |
| SEC-38 | Magic bytes, ≤ 5 MB, re-encode, private keys, authorised reads | `attachments/` | unit `SEC-38 uploads`; integration upload checks (PNG 201, SVG 415, 6 MB 413, other driver 404) |
| SEC-39 | JSON ≤ 1 MB, multipart ≤ 6 MB, 30 s timeouts, list limits ≤ 100 | `main.ts`, gateway | – |
| SEC-42 | Error envelope without stacks | `AllExceptionsFilter` | integration `…errors leak no stack` |
| SEC-44 | Trim, NFC, control characters rejected | `safeText` | – |
| SEC-46/47 | CSP and headers (gateway for the app, helmet for the API) | `infra/nginx/gateway.conf`, `main.ts` | integration `sends security headers and no-store…` |
| SEC-49 | `Cache-Control: no-store` on API responses | `main.ts` hook | integration headers test |
| SEC-50 | Global 100/min per user/IP; login 10/min per IP and back-off after 5 failures per IP + account, 50 per IP; refresh 30/min; uploads 20/min; sync 30/min; ≤ 3 SSE streams | throttler, `LoginLimiter`, controllers | integration `slows down repeated failed sign-ins with 429…` |
| SEC-51 | Trust exactly N proxy hops | `main.ts`, gateway appends XFF | – |
| SEC-52/53 | robots, noindex, docs off outside dev | gateway, `main.ts` | `curl /robots.txt` |
| SEC-56 | Health shows status booleans only | `health.controller.ts` | integration `health exposes no versions` |
| SEC-57/58 | No secrets in git; prod refuses weak config | `.gitignore`, `env.ts`, gitleaks | unit `refuses to start…` / `starts in production…` |
| SEC-60 | `wayflow_app` DML-only, audit append-only, reference read-only | `seed/run.ts ensureAppRole` | stack runs as that role |
| SEC-61 | DB/cache bound to 127.0.0.1 in dev, no host ports in prod | compose files | – |
| SEC-62 | Statement and idle-transaction timeouts, constraints | `drizzle.module.ts`, schema | – |
| SEC-64 | Non-root, read-only root FS, `cap_drop: ALL`, `no-new-privileges`, memory limits | Dockerfiles, compose | `docker compose exec api id` → uid 1000 |
| SEC-65 | Frozen lockfile, audit, Trivy | CI | CI `security` job |
| SEC-66/67/68 | Redacted logs; audit of logins, refresh reuse, overrides, publishes, resets; alert log at > 20 failed logins / 5 min | `main.ts`, `AuditService`, `LoginLimiter` | – |
| SEC-71 | Service worker precaches static assets only; `/api` never cached | `vite.config.ts` | – |
| SEC-72/73 | Per-user IndexedDB; logout keeps unsynced items locked to the user | `lib/offline/db.ts`, user menu | – |
| SEC-74/75/76 | Offline queue survives an expired session; every queued action re-authorised and idempotent per user; ≤ 100 actions | `SyncService`, `syncBatchSchema` | integration `gates start on the loader, applies actions idempotently…` (incl. another driver replaying an id) |
| SEC-79 | SSE authenticated by cookie, events fanned out to resolved recipients only | `NotificationsService` | – |

## Known limitations and future work

- **Loader auto-lock (SEC-78):** shared-terminal sessions expire after 30 idle minutes, but there is no PIN lock screen yet.
- **Local data purge (SEC-77):** cached run sheets are replaced on every refresh and logout clears them, but there is no 48-hour purge job for sent outbox items.
- **Photo retention (SEC-70):** add an S3 lifecycle rule (90 days) on the deployed bucket.
- **Row-Level Security (SEC-63)** and **TOTP MFA for the dispatcher (SEC-23)** are not implemented; the session design leaves room for MFA at login.
- **Recent-authentication** is required for demo reset and password change, not for publishing.
- **CSP** keeps `style-src 'unsafe-inline'` for React style attributes (progress bars); scripts are `'self'` only.
- **Rate-limit counters** for routes are per API instance; login back-off is shared through Valkey.
- **OWASP ZAP baseline** is not in CI; run `zap-baseline.py -t http://localhost:8080` against the stack before release.

## Pre-release checklist (deployed URL)

- [ ] `NODE_ENV=production`, unique secrets, `COOKIE_SECURE=true`, `CORS_ORIGINS=https://<domain>`, unique `SEED_DEFAULT_PASSWORD`
- [ ] `curl -I https://<domain>/` shows CSP, HSTS, nosniff, `X-Frame-Options: DENY`, `X-Robots-Tag`
- [ ] Cookies carry `__Host-` / `__Secure-` and `Secure`
- [ ] `ENABLE_DEMO_TOOLS` set on purpose; API docs not reachable
- [ ] Integration suite passes against the deployed URL (`API_URL=https://<domain>/api/v1`)
- [ ] Backups and a billing alarm configured

## After the competition

Rotate `JWT_SECRET`, `REFRESH_TOKEN_PEPPER`, `CSRF_SECRET` (this signs everyone out), set new passwords for every seeded account or delete them, rotate the S3 and database credentials, and take the deployment down or remove the competition data.

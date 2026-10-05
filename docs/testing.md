# Testing

| Level | Tool | Command | Needs | Count |
| --- | --- | --- | --- | --- |
| Business rules | Vitest | `pnpm --filter @wayflow/shared test` | nothing | 27 |
| Planner | pytest | `pnpm --filter @wayflow/planner test` | uv | 6 |
| API unit | Vitest | `pnpm --filter @wayflow/api test` | nothing | 25 |
| API integration | Vitest + fetch | `pnpm --filter @wayflow/api test:integration` | running stack + CSVs | 19 |
| End to end | Playwright | `pnpm test:e2e` | running app + CSVs | 1 walkthrough |

`pnpm test` runs the first three (what CI runs, with lint, typecheck, build, gitleaks, `pnpm audit` and Trivy).

## Unit tests

- `packages/shared/test/rules.test.ts`: every feasibility rule pass and fail; the booklet's worked examples (Gampaha 101 min, Colombo 112 min, 213 of 270 with the third trip rejected); separate Fresh and Style + Tech budgets; fuel quota; workshop vehicles; non-operating day; mall windows; stop sequencing and waiting for the window; legal and illegal transitions for orders, trips and stops.
- `packages/shared/test/cutoff.test.ts`: 15:59 goes to the next run, 16:00 to the following one, Saturday evening to Monday; time helpers; priority policy order.
- `services/planner/tests/test_solver.py`: trip-time formula; brand/district and capacity hold; chilled and van-only matching; Fresh budget; priority wins scarce capacity; determinism.
- `apps/api/test/unit/allocation.test.ts`: fallback engine feasibility and determinism; repair; mall post-pass; every deferral-explanation branch.
- `apps/api/test/unit/security.test.ts`: Argon2id parameters and unique salts; rehash detection; password policy; JWT alg/key/audience/expiry; refresh token entropy and hashing; CSRF binding; Origin check; magic bytes; EXIF and payload stripping; production config refusal and acceptance.
- `apps/api/test/unit/routes.test.ts`: the public route allow-list (SEC-25) and role declarations per controller.

## Integration tests (against the stack)

```sh
docker compose up -d --build
pnpm --filter @wayflow/api test:integration          # API_URL defaults to http://localhost:8080/api/v1
```

The suite resets the demo through the dispatcher's demo tools, then checks: unauthenticated access to every protected route; the role matrix; the 15:59/16:00 cutoff; order idempotency; allocation on the real S1 day (< 5 s, every order once, every deferral explained); a blocked move leaves the plan unchanged; defer + publish notifies the store with the reason; mass assignment; IDOR across outlets, depots and vehicles; the loader gate on trip start; sync idempotency and replay by another user; uploads (PNG accepted, SVG and 6 MB rejected, another driver denied); cookie flags; CSRF; refresh reuse detection; logout revocation; headers and error envelopes; SQL-injection text; health output; login rate limiting (runs last).

It signs in about ten times; the login route allows 10 per minute per IP, so wait a minute between runs.

## End-to-end walkthrough

```sh
pnpm dev                     # or the stack
pnpm test:e2e                # E2E_BASE_URL=http://localhost:8080 for the stack
```

`apps/web/e2e/walkthrough.spec.ts` drives four browser contexts: the store manager places a chilled and an ambient order; the dispatcher views the queue, runs both depots, checks a blocked move and publishes (acknowledging the second deferral); the store sees *Scheduled*; the clock moves to 03:15; the Kandy loader ticks every order and marks the vehicle loaded; the driver starts, **goes offline**, records two deliveries (*Saved on this device*, "Offline · 2 pending"), reloads offline (stack only: needs the service worker), comes back online and sees "Online · synced"; the dispatcher's live data shows the deliveries.

## Manual checks before a release

- Every role at 360, 390 and 768 px wide: no horizontal scroll (the screenshot script used during development checks `scrollWidth`).
- Lighthouse PWA and accessibility on the sign-in page and the driver run.
- The [security checklist](security.md#pre-release-checklist-deployed-url) on the deployed URL.

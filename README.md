# WayFlow — Waypoint delivery planning

WayFlow connects one delivery day for Waypoint Group across four roles: a **store manager** orders before the 16:00 cutoff, the **dispatcher** allocates orders to vehicles and trips under every operating rule and explains each deferral, the **loader** loads in reverse stop order and flags shortfalls, and the **driver** records deliveries with proof of delivery, offline if needed. Built for the Tech-Triathlon 2026 Hackathon.

| | |
| --- | --- |
| Web | React 19 PWA (Vite, TanStack Router + Query, Tailwind v4), one app for all four roles |
| API | NestJS 12 on Fastify, Drizzle ORM, PostgreSQL 18 |
| Allocation engine | Python 3.12 + Google OR-Tools CP-SAT, re-validated by shared TypeScript rules |
| Live updates | Server-sent events fanned out through Valkey |
| Files | RustFS (S3-compatible), private bucket, proxied reads |

**Docs:** [Getting started](docs/getting-started.md) · [How it works inside](docs/architecture.md) · [Planning engine](docs/planning-engine.md) · [Data model](docs/data-model.md) · [Security](docs/security.md) · [Testing](docs/testing.md) · [Deployment](docs/deployment.md) · [Decisions](docs/decisions.md) · [Design departures](docs/design-departures.md) · [Screen map](docs/screen-map.md) · [AI tool disclosure](docs/ai-tool-disclosure.md)

---

## 1. Quick start (Docker, the judge path)

Requires Docker Desktop (or Docker Engine + Compose v2) and the competition CSVs.

```sh
# 1. Put the competition files in data/source/ (see data/README.md). They are not in git.
# 2. Start everything:
docker compose up --build
```

Open **http://localhost:8080**. The first start takes a few minutes (image builds). Compose starts Postgres, Valkey and RustFS, runs the one-shot **`migrate`** job (migrations → least-privilege DB role → CSV load with row-count checks → demo seed), then the planner, the API and the gateway. A `.env` is optional: every value has a local-demo default. Copy `.env.example` to `.env` to change them.

| URL | What |
| --- | --- |
| http://localhost:8080 | The app (sign-in page) |
| http://localhost:8080/api/v1/health | Dependency health: db, valkey, storage, planner |
| http://localhost:9001 | RustFS console (uploaded photos), `rustfsadmin` / `rustfsadmin-change-me` |

The seed log prints the row counts it verified (120 outlets, 60 vehicles, 910 calendar days, 12 districts, 9 allowances, 576 traffic rows, 10,920 road rows) and a capacity-vs-demand report for the demo day:

```
docker compose logs migrate
```

To start over: `docker compose down -v && docker compose up --build`, or use **Change → Reset demo data** on the dispatcher sidebar.

## 2. Seeded accounts

Every account uses the password from `SEED_DEFAULT_PASSWORD`; the local default is **`Waypoint-Demo-2026!`**. Use a unique password for any deployment.

| Role | Email | Scope |
| --- | --- | --- |
| Dispatcher | `kasun@waypoint.lk` | Both depots; demo tools (simulation clock, reset) |
| Store manager | `out105@waypoint.lk` | Waypoint Fresh Nuwara Eliya 2 (OUT105), Kandy depot |
| Loader | `kandy-dock@waypoint.lk` | Kandy hub dock |
| Driver | `sampath@waypoint.lk` | VEH040, refrigerated truck, Kandy depot |

More accounts: `peliyagoda-dock@waypoint.lk` (Peliyagoda loader), `driver.veh001@waypoint.lk` … `driver.veh060@waypoint.lk` (one per vehicle), `out001@waypoint.lk` … `out120@waypoint.lk` (one per outlet).

## 3. Judge walkthrough

The demo runs on a **simulation clock** because the competition calendar ends on 28 Jun 2026 ([why](docs/decisions.md#adr-04-simulation-clock)). It starts at **Tue 19 May 2026, 14:00**, two hours before the cutoff for the **Wed 20 May** run, the day the Designathon screens show. The dispatcher moves the clock from the sidebar (**Simulated time → Change**).

The 20 May data: **Peliyagoda** uses the 85 real orders of the Task 2B peak-day scenario S1 (10 vehicles in the workshop, chilled demand above refrigerated capacity, so deferrals are unavoidable). **Kandy** uses synthetic orders generated from each outlet's own history in `deliveries_train.csv` (a normal day; one refrigerated van, VEH058, in the workshop).

| # | Role (device) | Do this | You should see |
| --- | --- | --- | --- |
| 1 | Store manager (`out105@…`, phone or desktop) | **Place order**: 38 chilled units, 40 ambient units, **Place order** | Cutoff countdown, estimated load from order history, "Goes to the 20 May run"; toast; both orders under **My deliveries** as *Ordered* |
| 2 | Dispatcher (`kasun@…`, desktop) | **Order queue** | All orders for the 20 May run with load, window, rule chips (Chilled, Van only, Mall window, Skipped last run) and filters |
| 3 | Dispatcher | **Plan board → Run allocation** for Peliyagoda, then Kandy | Trip cards with weight, volume and trip-time gauges, fuel against weekly quota; Peliyagoda banner "77 served, 8 deferred (… unavoidable, … by choice)" and the limiting resource |
| 4 | Dispatcher | Open a Kandy trip, **Move** a chilled order to an ambient truck such as VEH044 → **Check move** | "Move blocked" with the exact rule; the plan does not change |
| 5 | Dispatcher | **Deferrals**: read each reason and explanation, edit a store notice; **Plan board → Policy write-up** | Unavoidable vs choice, skipped-before outlets; a printable one-page policy computed from this plan |
| 6 | Dispatcher | **Publish plan** (acknowledge the second deferral if asked) | "Plan published"; loader, drivers and stores are notified |
| 7 | Store manager | **My deliveries** | Orders *Scheduled* with a planned arrival; deferred stores (e.g. `out053@…`) see the reason and the next run |
| 8 | Dispatcher | Sidebar clock → **Wed 20 May, 03:15 — loading at the dock** | Clock moves; field screens refresh |
| 9 | Loader (`kandy-dock@…`, tablet) | **Today's loads → VEH040-T1** | Load list in reverse stop order ("Load in this order, last stop first") with trip limits |
| 10 | Loader | **Report missing or damaged** on one order: 2 units missing → **Send report** | "Sent … The dispatcher and the store have been told"; dispatcher gets a critical alert; the store is told the order arrives short |
| 11 | Loader | Tick the rest → **Mark loaded** | Trip *Loaded*; the driver is notified that Start is enabled |
| 12 | Driver (`sampath@…`, phone) | **Start trip 1** | Dispatcher **Live tracking** shows VEH040-T1 on the road |
| 13 | Driver | Go offline (DevTools → Network → Offline), **Record delivery** for two stops (one with a photo) | Amber offline banner, "Offline · 2 pending", stops show *Not synced yet*; reload still works |
| 14 | Driver | Go back online | "Signal is back. Sending…" then "All synced"; **Offline and Sync** lists what was sent |
| 15 | Dispatcher | **Live tracking** | Delivered stops, late-risk flags, exceptions (shortfall, any road problem); click an exception for details and actions |
| 16 | Store manager | **Confirm receipt → Report a problem**: 2 damaged units, "Crushed cases", photo | Order *Issue reported*; dispatcher sees a receipt issue on the live board |
| 17 | Dispatcher | **Fleet → Send to workshop** on a vehicle with trips | Its trips are re-planned and republished; loader and driver see "Plan changed" with the diff |

The same walkthrough runs automatically: `pnpm test:e2e` (see [Testing](docs/testing.md)).

## 4. What each role can do

**Store manager** (S-01…S-08): place orders in units with a load estimate from history (Fresh can send chilled and ambient for the same day), cutoff countdown and after-cutoff notice, cancel before the cutoff, deliveries with planned or live ETA and late risk, "updates delayed" when the vehicle goes silent, deferral notice with reason and next run, confirm receipt or report short/damaged goods with a photo.

**Dispatcher** (D-01…D-11): order queue with filters; allocation per depot in under 5 s; plan board with kg, m³, trip-time and fuel gauges; validated moves and deferrals with a required reason; deferral page with unavoidable/choice split, explanations and store notice; publish and automatic republish with a versioned diff; live tracking with KPIs, progress, exceptions and active trips; exception detail with resolve and reschedule; fleet availability with automatic re-plan; outlet history; generated policy write-up; simulation clock and demo reset.

**Loader** (L-01…L-08): depot trips for the run, load list in loading order, temperature and fragile tags, tick-off, shortfall or damage report with photo, "Mark loaded" gate, plan-changed banner with the diff. Works offline.

**Driver** (R-01…R-08): run sheet with next stop, trip limits, start gated by the loader, stop detail, delivered / partly delivered / not delivered with reason chips, recipient, photo and optional location, problem report with delay, offline queue with automatic sync, conflicts and rejections surfaced. Works offline, including after a reload.

**Everyone:** green top loader, skeletons and spinners, breadcrumbs, toasts, notification centre with live updates, empty/error/offline states, 44 px touch targets, no horizontal scroll at 360 px, profile with active sessions and password change.

## 5. How the rules are enforced

Every allocation, whether from the engine or a manual move, passes `validateAllocation` in [`packages/shared/src/rules/validate.ts`](packages/shared/src/rules/validate.ts) on the server before anything is saved:

| Rule | Where | Test |
| --- | --- | --- |
| One brand + one district per trip | `validate.ts`, CP-SAT bucket variables | `packages/shared/test/rules.test.ts` |
| Chilled only on reefers; van-only outlets only by van; home depot | `vehicleCompatibility` | same |
| Whole orders, each on one trip | `validate.ts`, CP-SAT at-most-one | same |
| Weight **and** volume per trip | `validate.ts`, CP-SAT capacity | same |
| ≤ 2 trips per vehicle per day | `validate.ts`, DB check + unique index | same |
| Fresh 270 min and Style + Tech 480 min budgets (Task 2B formula) | `trip-time.ts` | booklet examples 101 / 112 / 213 min |
| Weekly fuel quota | `validate.ts` | same |
| Mall windows, operating days, workshop vehicles | `validate.ts`, `schedule.ts` | same |
| 16:00 cutoff | `rules/cutoff.ts`, `StoreService.place` | `cutoff.test.ts`, integration 15:59 / 16:00 |
| Every deferral has a reason | DB check constraint, publish guard | integration "planning" |

Status changes go through transition tables in [`state-machines.ts`](packages/shared/src/state-machines.ts) and are audited.

## 6. Configuration

All settings come from the environment ([`.env.example`](.env.example)); the API validates them at start-up and **refuses to start in production** on example secrets.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` enables HSTS, secret checks and disables API docs |
| `APP_SIMULATION_DATE` / `APP_SIMULATION_TIME` | `2026-05-19` / `14:00` | Start of the simulation clock (Asia/Colombo) |
| `ENABLE_DEMO_TOOLS` | `true` | Dispatcher-only clock and demo reset |
| `SEED_DEFAULT_PASSWORD` | `Waypoint-Demo-2026!` | Password for every seeded account |
| `JWT_SECRET`, `REFRESH_TOKEN_PEPPER`, `CSRF_SECRET` | dev placeholders | ≥ 32 chars, distinct in production |
| `COOKIE_SECURE` | `false` | `true` behind HTTPS (required in production) |
| `CORS_ORIGINS` | `http://localhost:8080` | Exact allowed origins |
| `APP_DB_PASSWORD` | dev placeholder | Password of the least-privilege `wayflow_app` role |
| `POSTGRES_PORT`, `VALKEY_PORT`, `WEB_PORT` | `5432`, `6379`, `8080` | Host ports (DB and cache bound to 127.0.0.1) |
| `S3_*`, `RUSTFS_*` | dev placeholders | Object storage |

## 7. Local development

Requires Node 24, pnpm 11 (`corepack enable`), uv and Docker.

```sh
pnpm install
pnpm bootstrap     # creates .env from .env.example
pnpm dev           # infra in Docker, then hot reload: web :5173, api :3000, planner :8000
pnpm db:seed       # migrations + seed against the dev database (run once)
```

| Command | Does |
| --- | --- |
| `pnpm lint` / `pnpm typecheck` / `pnpm build` | What CI runs |
| `pnpm test` | Unit tests: shared rules, API, planner |
| `pnpm --filter @wayflow/api test:integration` | API integration suite against a running stack |
| `pnpm test:e2e` | Playwright walkthrough (set `E2E_BASE_URL=http://localhost:8080` for the stack) |
| `pnpm db:reset-demo` | Restore the seeded demo orders, remove plans and field records |
| `pnpm db:generate` / `pnpm db:migrate` / `pnpm db:studio` | Drizzle |
| `pnpm stack` | Full containerised stack in the background |

Full guide with troubleshooting: [docs/getting-started.md](docs/getting-started.md).

## 8. Offline and PWA: how to test

The driver and loader screens cache their run sheet or load list per user in IndexedDB, record every action locally first, and sync through an idempotent endpoint. In the stack (production build) the service worker also serves the app shell offline.

1. Sign in as `sampath@waypoint.lk` at phone width, open **My Run** once while online.
2. DevTools → Network → **Offline**. Record a delivery: the stop shows *Not synced yet*, the header says "Offline · 1 pending".
3. Reload the page: the run sheet and the pending item are still there.
4. Go back **Online**: the outbox drains in order and a toast confirms "All synced". Replays are harmless: the server answers `duplicate`.

Conflicts follow [specs/08 §4](specs/08-offline-and-sync.md): a delivery recorded offline on an order the dispatcher moved meanwhile is kept, flagged for review and reported to the dispatcher.

## 9. Architecture in one picture

```
browser ──► gateway (nginx :8080, CSP + headers) ──┬─► web (static PWA)
                                                    └─► /api ─► api (NestJS) ──┬─► postgres (app role: DML only)
                                                                               ├─► valkey (SSE fan-out, login limiter)
                                                                               ├─► rustfs (private bucket)
                                                                               └─► planner (OR-Tools, internal only)
```

Details, sequence diagrams and the request lifecycle: [docs/architecture.md](docs/architecture.md).

## 10. Design departures

Summarised from [docs/design-departures.md](docs/design-departures.md): the sign-in uses the AUTH-01 layout with the hero video in place of the green panel; no "Create account", "Remember me" or public demo-account list (security rules); the shared-tablet "Who is loading?" picker is replaced by normal sign-in; Fleet and Profile screens and the driver problem report are additions; demo data is real CSV data, so names, IDs and counts differ from the Figma sample values.

## 11. Deployment

Production runs on one AWS EC2 host (host nginx + certbot for HTTPS, `docker-compose.prod.yml` for production settings). See [docs/deployment-ec2.md](docs/deployment-ec2.md).

## 12. AI tool disclosure

The system was built with Claude Code (Anthropic) from the team's specifications and Figma designs; competition CSV rows were never sent to the model, only headers, counts and aggregates. Details: [docs/ai-tool-disclosure.md](docs/ai-tool-disclosure.md).

## 13. Data notice

Competition data is synthetic and used under the competition terms; it is not for redistribution. The CSVs are not committed (`data/` is git-ignored). Synthetic orders generated for Kandy are marked `source = synthetic_seed`.

## 14. Known limitations

- SSE fan-out uses Valkey pub/sub; the throttler and the simulation-clock cache are per API instance.
- No password-reset flow (accounts are admin-managed, specs/19 SEC-09); no MFA yet.
- ETAs use district-level travel times, not road routing; there is no map.
- Integration and end-to-end tests need the competition CSVs, so CI runs unit tests, lint, typecheck, build and security scans only.
- The planner model does not sequence stops; mall windows are enforced in a post-pass that defers an order when a trip would miss its mall window.
- The supplied hero video shows a manufacturer badge on the truck cab; replace it before any public release.

## Commits and releases

Conventional Commits (commitlint hook + PR-title check). release-please derives versions and `CHANGELOG.md`.

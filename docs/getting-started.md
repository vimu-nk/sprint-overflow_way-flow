# Getting started

Two ways to run WayFlow: the **Docker stack** (everything in containers, what judges use) and **local development** (infrastructure in Docker, app servers on your machine with hot reload).

## Prerequisites

| Tool | Version | Check | Needed for |
| --- | --- | --- | --- |
| Docker Desktop or Docker Engine + Compose v2 | recent | `docker compose version` | both |
| Node.js | 24 | `node -v` | local dev |
| pnpm | 11 (`corepack enable`) | `pnpm -v` | local dev |
| uv | recent | `uv --version` | local dev (planner) |

### Competition data

The CSVs are not in git (the competition terms forbid redistribution). Copy the organisers' bundle into `data/source/`, keeping their folder names:

```
data/source/
  General Data/        outlets.csv, vehicles.csv, calendar.csv, district_travel.csv,
                       service_allowance.csv, traffic_speed.csv, road_conditions.csv
  Training Data/       deliveries_train.csv, route_legs_train.csv
  Test Data/           task2b_peak_day_scenarios.csv, task2b_peak_day_fleet.csv, …
```

The seed needs the seven General Data files, `Training Data/deliveries_train.csv` (order-size history) and the two `task2b_*` files (the Peliyagoda demo day). If a file is missing or its header or row count is wrong, the seed stops with a message naming the file.

## Option A: Docker stack

```sh
docker compose up --build          # foreground, Ctrl+C to stop
# or
pnpm stack                         # same, in the background
```

What happens, in order:

1. `postgres`, `valkey`, `rustfs` start and pass their health checks.
2. `storage-init` creates the private bucket and an S3 user limited to it.
3. `migrate` (one-shot) applies the Drizzle migrations as the owner role, creates the least-privilege `wayflow_app` role, loads the CSVs with strict parsing and row-count assertions, creates the seeded accounts (each password hashed separately with Argon2id), seeds the demo orders and prints a capacity-vs-demand report. It is idempotent: on later starts it leaves existing orders alone.
4. `planner` (OR-Tools) and `api` start; the API connects as `wayflow_app`.
5. `web` (static PWA) and `gateway` (the only public port, 8080) start.

Open http://localhost:8080 and sign in with an account from the [README](../README.md#2-seeded-accounts).

| Task | Command |
| --- | --- |
| Logs of one service | `docker compose logs -f api` |
| Seed report | `docker compose logs migrate` |
| Restore the demo state | Dispatcher sidebar → **Change** → *Reset demo data*, or `docker compose run --rm migrate node dist/seed/run.js --reset` |
| Wipe everything | `docker compose down -v` |
| psql | `docker compose exec postgres psql -U wayflow -d wayflow` |
| Stop | `docker compose down` |

## Option B: local development

```sh
pnpm install
pnpm bootstrap                     # .env from .env.example (only if missing)
pnpm infra:up                      # postgres, valkey, rustfs + storage-init
pnpm db:seed                       # migrations + seed (first time)
pnpm dev                           # turbo TUI: web :5173, api :3000, planner :8000, shared watcher
```

Open http://localhost:5173. Vite proxies `/api` to the API on :3000. `pnpm dev` also runs `infra:up`.

`.env` uses `localhost` hosts; the containers use service names. If port 5432 is taken on your machine, set `POSTGRES_PORT=5433` and change the port in `DATABASE_URL` and `APP_DATABASE_URL`.

| Task | Command |
| --- | --- |
| Restore demo data | `pnpm db:reset-demo` |
| New migration after editing `apps/api/src/db/schema.ts` | `pnpm db:generate`, review the SQL, `pnpm db:migrate` |
| Browse the database | `pnpm db:studio` |
| API docs (dev only) | http://localhost:3000/api/docs |
| Free stuck ports | `pnpm kill` |

## Running the demo day

The app clock is simulated (calendar data ends 28 Jun 2026). It starts at **Tue 19 May 2026 14:00** and runs at normal speed. The dispatcher can jump it from the sidebar:

| Preset | Use it for |
| --- | --- |
| Tue 19 May, 14:00 | Store orders before the cutoff, allocation and publish |
| Tue 19 May, 16:30 | The after-cutoff screen (orders go to the 21 May run) |
| Wed 20 May, 03:15 | Loading at the dock |
| Wed 20 May, 05:30 | Vehicles on the road, live ETAs |

A departed vehicle that sends nothing for 30 simulated minutes shows as **Vehicle offline** on the live board and as **Updates delayed** for its stores.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `migrate` exits with "Missing dataset file" | Put the CSVs in `data/source/` with the original folder names |
| `migrate` exits with a row-count or header error | A CSV is incomplete or changed; re-copy it from the bundle |
| Port 8080 or 5432 already in use | Set `WEB_PORT` / `POSTGRES_PORT` in `.env` |
| "Too many requests" when signing in | Login is throttled per IP (10 per minute) and per IP + account after 5 failures; wait a minute |
| API container restarting with "Refusing to start in production" | `NODE_ENV=production` needs real secrets and `COOKIE_SECURE=true` (see [deployment](deployment.md)) |
| Health shows `planner: false` | Allocation still works with the built-in fallback engine; check `docker compose logs planner` |
| Field screens do not work offline in `pnpm dev` | The service worker only runs in the production build; use the stack, or open each screen once while online |
| Photos do not load | Check `storage: true` in `/api/v1/health`; the bucket is created by `storage-init` |

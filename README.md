# WayFlow

Delivery planning system for Waypoint Group (Tech-Triathlon 2026 Hackathon).

## Stack

| Part | Tech |
| --- | --- |
| `apps/web` | React 19, Vite, TanStack Router + Query, Tailwind v4, PWA |
| `apps/api` | NestJS 12 (Fastify), Drizzle ORM, Swagger |
| `services/planner` | Python 3.12, FastAPI, Google OR-Tools CP-SAT |
| `packages/shared` | Zod schemas and types shared by web and api |
| Data | PostgreSQL 18, Valkey 9, RustFS (S3-compatible object storage) |
| Infra | Docker Compose, nginx gateway |

## Services

```
browser ──► gateway (nginx :8080) ──┬─► web (static SPA)
                                    └─► /api ─► api (NestJS) ──┬─► postgres
                                                               ├─► valkey
                                                               ├─► rustfs (S3)
                                                               └─► planner (internal only)
```

## Quick start (Docker)

```sh
cp .env.example .env
docker compose up --build
```

- App: http://localhost:8080
- API health (checks db, valkey, storage, planner): http://localhost:8080/api/health
- API docs: http://localhost:8080/api/docs
- RustFS console: http://localhost:9001

### RustFS credentials

| Purpose | Env vars | Default |
| --- | --- | --- |
| Console login (admin/root) | `RUSTFS_ADMIN_USER` / `RUSTFS_ADMIN_PASSWORD` | `rustfsadmin` / `rustfsadmin-change-me` |
| API access key (limited to `S3_BUCKET`) | `S3_ACCESS_KEY` / `S3_SECRET_KEY` | `wayflow-app` / `wayflow-app-secret` |

The one-shot `storage-init` container (`infra/rustfs/init.sh`) runs on every `up`. It creates the bucket, the `wayflow-app` policy and the API user. Change the defaults in `.env` for any shared deployment.

## Local development

Requires Node 24, pnpm 11, uv and Docker.

```sh
pnpm install
pnpm bootstrap      # creates .env from .env.example
pnpm dev            # infra in Docker + hot-reload web :5173, api :3000, planner :8000
```

| Command | Does |
| --- | --- |
| `pnpm dev` | Start postgres, valkey, rustfs (+ init), then all dev servers with hot reload in the turbo TUI |
| `pnpm kill` | Free ports 5173, 3000, 8000 and 4983 after a crashed session |
| `pnpm infra:up` / `infra:down` / `infra:logs` | Backing services only |
| `pnpm infra:reset` | Delete all local volumes (database, cache, object storage) |
| `pnpm db:studio` | Drizzle Studio at https://local.drizzle.studio |
| `pnpm db:generate` / `db:migrate` | Create / apply migrations |
| `pnpm stack` | Full containerised stack at http://localhost:8080 |

## Commits and releases

- Commits follow [Conventional Commits](https://www.conventionalcommits.org), enforced by a commitlint `commit-msg` hook (husky) and a PR-title check. Allowed scopes: `web`, `api`, `planner`, `shared`, `infra`, `deps`, `release`.
- On every push to `main`, [release-please](https://github.com/googleapis/release-please) opens or updates a release PR with the next version and `CHANGELOG.md`. The whole product shares one version, which is kept in sync across all `package.json` files and `pyproject.toml`.
- Merging the release PR tags `vX.Y.Z`, creates a GitHub release, and pushes `wayflow-web`, `wayflow-api` and `wayflow-planner` images to GHCR tagged `X.Y.Z` and `latest`.
- Release PRs opened with the default `GITHUB_TOKEN` do not trigger CI. To run CI on them, add a `RELEASE_PLEASE_TOKEN` secret containing a PAT or GitHub App token.

## Repository layout

- `design/`: Designathon Figma HTML exports (implementation spec)
- `data/`: competition datasets (not committed, see `data/README.md`)
- `infra/nginx/`: gateway config
- `docs/`: challenge booklet, architecture, data model, AI disclosure

<!-- TODO: seeded accounts, judge walkthrough, departures from Designathon design -->

# WayFlow

Delivery planning system for Waypoint Group, built for the Tech-Triathlon 2026 hackathon. The brief is `docs/Challenge Booklet.pdf` (Hackathon: p.11–13; domain rules: p.3–7, p.20–21). Judging weights engineering quality, the allocation engine, offline/degradation handling, and fidelity to the Designathon designs.

## Workspace

| Path | What |
| --- | --- |
| `apps/web` | React PWA for all four roles (dispatcher, loader, driver, store manager) |
| `apps/api` | NestJS API, the only service the browser talks to |
| `services/planner` | Python OR-Tools allocation engine, internal only (called by api) |
| `packages/shared` | Zod schemas and types shared by web and api |
| `infra/` | nginx gateway config, RustFS provisioning |
| `design/` | Designathon Figma HTML exports: the UI spec |
| `data/` | Competition CSVs (gitignored) |

## Commands

| Command | Does |
| --- | --- |
| `pnpm bootstrap` | Create `.env` from `.env.example` |
| `pnpm dev` | Start infra (postgres, valkey, rustfs + init), then hot-reload web :5173, api :3000, shared, planner :8000 |
| `pnpm kill` | Free ports 5173, 3000, 8000 and 4983 after a crashed session |
| `pnpm infra:up` / `infra:down` / `infra:logs` | Backing services only |
| `pnpm infra:reset` | **Destroys** all local volumes (DB, Valkey, RustFS data) |
| `pnpm db:studio` | Drizzle Studio at https://local.drizzle.studio |
| `pnpm db:generate` / `db:migrate` | Create / apply Drizzle migrations |
| `pnpm stack` | Full containerised stack at http://localhost:8080 (the judge path) |
| `pnpm lint` / `typecheck` / `build` | What CI runs |

## Rules

- **Commits**: Conventional Commits, enforced by commitlint. Scopes: `web`, `api`, `planner`, `shared`, `infra`, `deps`, `release`. release-please derives versions and `CHANGELOG.md` from them, so never hand-edit versions or the changelog.
- **TypeScript is pinned to `~6.0`** because typescript-eslint does not support 7 yet. Do not bump it.
- **Never commit `data/`**. The competition T&C forbid redistributing the datasets.
- **`design/` is the spec.** Match layouts, copy and flows. Record any intentional departure in README ("Departures from the Designathon design").
- **The planner stays internal.** Browser → gateway → api → planner. Never expose it through nginx.
- **Constraints are law.** Every allocation (planner output or manual edit) must satisfy capacity (kg and m³), reefer, van_only, home depot, delivery windows, trip-time budgets and fuel quota, and every deferred order needs a reason.
- **Offline first for driver and loader.** Their screens are judged at phone width and must work without a connection.
- `docker compose up` on a fresh clone must start everything, seed data included. Keep it that way.

# apps/api

NestJS 12 on the Fastify adapter. **ESM only**: relative imports need the `.js` suffix (`./db/drizzle.module.js`).

- One Nest module per domain (orders, planning, dispatch, loading, delivery, sync, ...). Keep controllers thin and put logic in services.
- Infrastructure clients are global modules exposing DI tokens: `DB` (Drizzle, `src/db/drizzle.module.ts`), `VALKEY` (`src/valkey/valkey.module.ts`), `S3` + `BUCKET` (`src/storage/storage.module.ts`). Inject with `@Inject(TOKEN)` and add new clients the same way.
- `src/env.ts` loads the repo-root `.env` for host dev and must stay the first import in `main.ts`. Containers get env from compose.
- Request/response shapes live as Zod schemas in `@wayflow/shared` so web and api share them. Rebuild shared (`pnpm dev` watches it) after changing it.
- Database: tables go in `src/db/schema.ts`. Create migrations with `pnpm db:generate` and apply them with `pnpm db:migrate`. Never hand-edit generated SQL. Put invariants in DB constraints where possible.
- The S3 key is scoped to the `pod` bucket only. RustFS provisioning lives in `infra/rustfs/init.sh`, not in API code.
- Swagger UI: `/api/docs`. `/api/health` checks db, valkey, storage and planner.

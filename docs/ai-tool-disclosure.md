# AI tool disclosure

## Tools used

| Tool | Model | Where used |
| --- | --- | --- |
| Claude Code (Anthropic) | Claude Opus 5.5 | Implementation of the API, planner, web app, seed, tests, Docker setup and documentation, from the team's specifications |
| Video generator (team) | not recorded here | The truck hero video supplied by the team (`apps/web/public/hero.mp4`) |

## What was AI-assisted

- **Scaffold-to-system build:** database schema and migrations, CSV loaders and demo-data generator, NestJS modules (auth, planning, dispatcher, store, field sync, notifications, attachments), the OR-Tools CP-SAT model, the shared rules package, all role screens, the offline outbox and sync engine.
- **Tests:** unit, integration and Playwright suites; they were run and the failures they found were fixed (examples below).
- **Infrastructure:** Dockerfiles, compose files, nginx configuration, CI workflow.
- **Documentation:** README and everything in `docs/`.
- **Media processing:** transcoding the supplied hero video into compressed desktop/mobile variants and posters (ffmpeg in Docker).

## What was not AI-assisted

- Problem framing, scope and priorities, the specification pack in `specs/`, and the Figma designs from the Designathon.
- The decision to use the Task 2B scenario and order history as demo data sources, the stack choice and repository scaffold.
- Final review of the code and documents, manual testing and deployment decisions (by the team).

## How AI was used

The team wrote the specifications (`specs/01`–`20`) and design exports; Claude Code read them, implemented the system phase by phase, ran lint, typecheck, unit tests, integration tests, the Playwright walkthrough and a clean `docker compose up`, and committed with Conventional Commits. Examples of problems found by running the system and fixed:

1. The seed reused one Argon2 hash for all accounts (same salt); found by checking distinct hashes and fixed to hash each account separately (SEC-02).
2. Publishing two depots at once lost the second-deferral acknowledgement; found by the Playwright walkthrough and fixed by publishing sequentially.
3. Actions queued while a sync was in flight waited for the 30-second timer; found by the walkthrough's offline step and fixed in the sync engine.
4. A conflicting offline delivery was rolled back with the transaction that detected it; fixed so the field fact commits and is returned as `conflict`.
5. The login limiter keyed failures per IP and per account separately, so one user's mistakes could lock out a shared IP; changed to the IP + account pair from SEC-50.

## Data handling

The competition datasets stayed on the development machine. The AI agent inspected only file headers, row counts and distinct values of categorical columns (e.g. depots, vehicle types, scenario IDs) and aggregate statistics (average order size per depot and brand), never whole files or raw rows. The seed reads the CSVs locally inside Docker.

## Human oversight

Reviewed by: _team to fill in_. Verification: `pnpm lint`, `pnpm typecheck`, `pnpm test`, the integration suite and the Playwright walkthrough against `docker compose up`, plus a manual walkthrough on phone and desktop.

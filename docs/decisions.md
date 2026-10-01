# Decisions

Short records: context → decision → consequence.

## ADR-01 Stack follows the scaffold, not the older spec wording

**Context.** `specs/04` names Next.js and MinIO; the repository scaffold and `CLAUDE.md` fix React + Vite (TanStack Router), NestJS on Fastify, a Python OR-Tools planner, Valkey and RustFS.
**Decision.** Follow the scaffold. `nextjs-toploader` becomes a small top loader bound to router and mutation state; Serwist becomes `vite-plugin-pwa`; MinIO becomes RustFS (same S3 API).
**Consequence.** Same behaviours as the specs; the swaps are listed in the design departures.

## ADR-02 Allocation in OR-Tools, rules in TypeScript

**Context.** The engine must be feasible under all rules and explainable; manual overrides must use the same rules.
**Decision.** The planner (CP-SAT) optimises assignment; `packages/shared` owns the rules (`validateAllocation`, trip-time formula, schedule). The API re-validates every planner result and every move, explains deferrals and enforces mall windows in a post-pass. A TypeScript greedy engine is the fallback when the planner is down.
**Consequence.** One rulebook, two engines that cannot disagree on feasibility; the planner's own `CLAUDE.md` asks for reason codes from the planner, but reasons are produced in the API where the rules live.

## ADR-03 Demo data

**Context.** No order files except history and the Task 2B scenario; the brief forbids dummy data.
**Decision.** Peliyagoda, 20 May 2026: the 85 real S1 orders and the S1 fleet status (10 vehicles in the workshop). Kandy: synthetic orders (`source = synthetic_seed`, fixed seed) generated per outlet from its own order frequency and median sizes in `deliveries_train.csv`, plus five synthetic history days so "skipped last run" and "days since last served" are real values. Users are demo accounts named as in the Figma sign-in frame; every other vehicle and outlet gets a generic account.
**Consequence.** One over-capacity depot (deferrals unavoidable) and one normal depot, as specs/10 asks. Figma sample IDs (ORD1000101…) do not match the real data.

## ADR-04 Simulation clock

**Context.** The calendar, traffic and road data end on 28 Jun 2026; the demo is in Oct 2026.
**Decision.** A dispatcher-adjustable clock (anchor in `app_settings`, advancing in real time) starts at Tue 19 May 2026 14:00 (`APP_SIMULATION_DATE/TIME`). Cutoff, run dates, field event times, exceptions and notifications use it. Outside the calendar range: Sunday closed, otherwise operating, no disruption, with a notice.
**Consequence.** Judges can replay the day from ordering to receipt. Security timers (tokens, rate limits, audit) stay on real time.

## ADR-05 Orders are entered in units

**Context.** The Figma order form asks for chilled and ambient units and shows an estimated load; planning needs kg and m³.
**Decision.** kg and m³ are units × the average kg and m³ per unit for that brand and temperature in `deliveries_train.csv` (`unit_profiles`).
**Consequence.** The estimate shown before placing is the value stored.

## ADR-06 Placing an order confirms it

**Context.** F6 has draft → confirmed; the Figma flow has one "Place order" button and "Status when placed: Ordered".
**Decision.** Place = create draft and confirm in one transaction through the transition table; edits are replaced by cancel-before-cutoff and re-order.
**Consequence.** Matches the design; the draft state exists in the model and audit log.

## ADR-07 Changes to a published plan republish automatically

**Context.** D2 "edit published plan" says a change is republished and the loader and drivers are alerted.
**Decision.** A valid move, deferral or re-plan on a published plan publishes version N+1 with a diff immediately. If a second consecutive deferral needs acknowledgement, the plan stays `replanned` until the dispatcher republishes.
**Consequence.** Field screens never show unannounced changes; every version has a stored snapshot and diff.

## ADR-08 Deferred orders are carried as new orders

**Context.** F6 has deferred → confirmed on the next operating day, while the queue and history must still show the deferral on its own day.
**Decision.** At publish, each deferred order gets a copy on the next operating day (`ref-C1`, `carried_from_id`, `deferred_yesterday = true`, priority boost). If the original is later served, the copy is cancelled.
**Consequence.** Deferral history stays on its run date; the next queue shows "Skipped last run".

## ADR-09 One stop per order

**Context.** The Task 2B formula counts orders (`inter_stop × (n − 1)`); Figma groups orders by outlet at a stop.
**Decision.** Store one stop row per order, keep orders for an outlet adjacent, group them in the driver UI. Trip-time feasibility uses the formula; ETAs treat consecutive orders for one outlet as one visit.
**Consequence.** Feasibility matches what judges replicate; arrival estimates stay realistic.

## ADR-10 Field actions go through one sync endpoint, online or offline

**Context.** Driver and loader must work offline; online and offline paths diverging would be a source of bugs.
**Decision.** Every loader and driver action is written to the per-user outbox first and sent through `POST /sync/batch`, whether or not the device is online.
**Consequence.** The offline path is the normal path and is exercised constantly; idempotency and re-authorisation apply to every action.

## ADR-11 Login throttling per IP + account

**Context.** SEC-50 asks for 5 attempts per 15 min per IP + account with back-off, without enabling lock-out DoS.
**Decision.** Back-off keys on the (IP, account) pair after 5 failures, plus an IP-wide ceiling of 50 failures, plus a route throttle of 10 sign-ins per minute per IP.
**Consequence.** One user's typos never lock out a shared office IP; repeated test runs from one machine can hit the 10/min route throttle (wait a minute).

## ADR-12 No public demo-account list, no self-service flows

**Context.** S0 shows demo accounts; AUTH-01/02 show "Create account" and "Forgot password"; specs/19 forbids self-registration and printing credentials on the landing page.
**Decision.** Credentials are in this README only; "Forgot password" explains that administrators reset passwords; no sign-up.
**Consequence.** Logged in the design departures.

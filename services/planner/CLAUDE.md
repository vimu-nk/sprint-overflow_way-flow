# services/planner

Python 3.12 FastAPI service that allocates orders to vehicles and trips with Google OR-Tools CP-SAT.

- Use **uv** only (`uv add`, `uv run`), never pip. Lint and format with ruff (`pnpm lint` runs it).
- Internal only: called by the api at `PLANNER_URL`, never exposed through the gateway.
- Every solve has a time limit and returns the best feasible solution.
- Output must mark every order served or deferred. Served orders get a vehicle and trip (1 or 2). Deferred orders get a reason code.
- Trip-time and feasibility rules are in the booklet (p.20–21). Keep them identical to the TypeScript validator in `@wayflow/shared`.

import logging

import ortools
from fastapi import FastAPI, HTTPException

from .model import PlanRequest, PlanResponse
from .solver import solve

logging.basicConfig(level=logging.INFO, format='{"level":"%(levelname)s","msg":"%(message)s"}')
log = logging.getLogger("planner")

# Internal service: reachable only from the api container, never through the gateway.
app = FastAPI(title="WayFlow Planner", docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "ortools": ortools.__version__}


@app.post("/plan", response_model=PlanResponse)
def plan(req: PlanRequest) -> PlanResponse:
    try:
        res = solve(req)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    log.info(
        "planned %s %s: %d orders, %d trips, %d unassigned, %s in %d ms",
        req.depot,
        req.date,
        len(req.orders),
        len(res.trips),
        len(res.unassigned),
        res.status,
        res.solve_ms,
    )
    return res

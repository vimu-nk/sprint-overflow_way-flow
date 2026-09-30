import ortools
from fastapi import FastAPI

app = FastAPI(title="WayFlow Planner")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "ortools": ortools.__version__}

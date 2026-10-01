"""Request/response contract between the API and the planner (all plain JSON)."""

from typing import Literal

from pydantic import BaseModel, Field

Brand = Literal["Fresh", "Style", "Tech"]


class Order(BaseModel):
    ref: str
    brand: Brand
    district: str
    chilled: bool
    van_only: bool
    weight_kg: float = Field(gt=0)
    volume_m3: float = Field(gt=0)
    service_min: float = Field(ge=0)
    priority: int = Field(ge=0)


class Vehicle(BaseModel):
    vehicle_id: str
    is_van: bool
    is_reefer: bool
    weight_cap_kg: float = Field(gt=0)
    volume_cap_m3: float = Field(gt=0)
    km_per_l: float = Field(gt=0)
    fuel_remaining_l: float


class Travel(BaseModel):
    outbound_min: float
    inter_stop_min: float
    outbound_km: float
    inter_stop_km: float


class Pin(BaseModel):
    """An order that must stay on (vehicle, trip) — e.g. already loaded or departed."""

    ref: str
    vehicle_id: str
    trip_no: int = Field(ge=1, le=2)


class Preference(BaseModel):
    """Current placement in a published plan; kept when possible to make re-plans stable."""

    ref: str
    vehicle_id: str
    trip_no: int = Field(ge=1, le=2)


class PlanRequest(BaseModel):
    date: str
    depot: Literal["Peliyagoda", "Kandy"]
    orders: list[Order] = Field(max_length=2000)
    vehicles: list[Vehicle] = Field(max_length=200)
    travel: dict[str, Travel]
    fresh_budget_min: int = 270
    trading_budget_min: int = 480
    max_trips: int = 2
    pins: list[Pin] = []
    preferences: list[Preference] = []
    deterministic_time: float = Field(default=4.0, gt=0, le=30)


class Trip(BaseModel):
    vehicle_id: str
    trip_no: int
    brand: Brand
    district: str
    order_refs: list[str]


class PlanResponse(BaseModel):
    trips: list[Trip]
    unassigned: list[str]
    status: str
    objective: float
    solve_ms: int

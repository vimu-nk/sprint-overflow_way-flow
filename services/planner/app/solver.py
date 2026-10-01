"""Allocation engine: CP-SAT model of the booklet's seven feasibility rules.

Decision variables
  z[v,t,b]  vehicle v runs trip t (1|2) for bucket b = (brand, district)       rule 1, rule 7
  x[o,v,t]  order o rides trip t of vehicle v (only created when compatible)  rules 2, 3, 4, 5

Constraints
  each order on at most one trip (served whole, or deferred)                  rule 5
  Σ kg ≤ cap_kg and Σ m³ ≤ cap_m³ per trip                                    rule 6
  Task 2B trip time, Fresh trips ≤ 270 and Style + Tech ≤ 480 per vehicle      rule 7
  fuel (with return leg) ≤ remaining weekly quota per vehicle
Objective
  maximise Σ priority of served orders (policy from specs/03 §9), then prefer fewer and
  smaller trips and keep a published plan's placements when re-planning.

The API sequences stops, checks mall windows and re-validates the result in TypeScript.
"""

import time
from collections import defaultdict

from ortools.sat.python import cp_model

from .model import PlanRequest, PlanResponse, Trip

KG = 10  # weight scale: 0.1 kg
M3 = 100  # volume scale: 0.01 m³
MIN = 10  # time scale: 0.1 min
KM = 10  # distance scale: 0.1 km


def trip_minutes(outbound: float, inter_stop: float, service: list[float]) -> float:
    """Task 2B formula: outbound + inter_stop × (n − 1) + Σ handling. No return leg."""
    if not service:
        return 0.0
    return outbound + inter_stop * (len(service) - 1) + sum(service)


def solve(req: PlanRequest) -> PlanResponse:
    started = time.perf_counter()
    m = cp_model.CpModel()
    trips = range(1, req.max_trips + 1)
    orders = sorted(req.orders, key=lambda o: o.ref)
    vehicles = sorted(req.vehicles, key=lambda v: v.vehicle_id)
    buckets = sorted({(o.brand, o.district) for o in orders})
    pins = {p.ref: (p.vehicle_id, p.trip_no) for p in req.pins}
    prefs = {p.ref: (p.vehicle_id, p.trip_no) for p in req.preferences}

    def compatible(o, v) -> bool:
        if o.chilled and not v.is_reefer:
            return False
        if o.van_only and not v.is_van:
            return False
        return o.district in req.travel

    z: dict[tuple[str, int, tuple[str, str]], cp_model.IntVar] = {}
    x: dict[tuple[str, str, int], cp_model.IntVar] = {}
    for v in vehicles:
        for t in trips:
            for b in buckets:
                z[v.vehicle_id, t, b] = m.new_bool_var(f"z_{v.vehicle_id}_{t}_{b[0]}_{b[1]}")
            m.add_at_most_one(z[v.vehicle_id, t, b] for b in buckets)
    for o in orders:
        for v in vehicles:
            if not compatible(o, v):
                continue
            for t in trips:
                var = m.new_bool_var(f"x_{o.ref}_{v.vehicle_id}_{t}")
                x[o.ref, v.vehicle_id, t] = var
                m.add_implication(var, z[v.vehicle_id, t, (o.brand, o.district)])

    by_order: dict[str, list] = defaultdict(list)
    by_trip: dict[tuple[str, int], list] = defaultdict(list)
    for (ref, vid, t), var in x.items():
        by_order[ref].append(var)
        by_trip[vid, t].append((ref, var))
    order_by_ref = {o.ref: o for o in orders}

    # Rule 5: each order at most once (deferred otherwise). Pins are forced.
    for o in orders:
        if o.ref in pins:
            vid, t = pins[o.ref]
            if (o.ref, vid, t) not in x:
                raise ValueError(f"Pinned order {o.ref} is not compatible with {vid}")
            m.add(x[o.ref, vid, t] == 1)
        if by_order[o.ref]:
            m.add_at_most_one(by_order[o.ref])

    fresh_buckets = [b for b in buckets if b[0] == "Fresh"]
    trading_buckets = [b for b in buckets if b[0] != "Fresh"]
    trip_cost = []

    for v in vehicles:
        vid = v.vehicle_id
        time_fresh, time_trading, km = [], [], []
        for t in trips:
            items = by_trip.get((vid, t), [])
            # A trip bucket is only open when it carries at least one order (no empty trips).
            for b in buckets:
                members = [var for ref, var in items if (order_by_ref[ref].brand, order_by_ref[ref].district) == b]
                if members:
                    m.add(z[vid, t, b] <= sum(members))
                else:
                    m.add(z[vid, t, b] == 0)
            # Rule 6: weight and volume.
            m.add(sum(round(order_by_ref[r].weight_kg * KG) * var for r, var in items) <= int(v.weight_cap_kg * KG))
            m.add(sum(round(order_by_ref[r].volume_m3 * M3) * var for r, var in items) <= int(v.volume_cap_m3 * M3))
            # Trip time: Σ_b z·(outbound − inter) + Σ_o x·(inter + service).
            for kind, bs, acc in (("fresh", fresh_buckets, time_fresh), ("trading", trading_buckets, time_trading)):
                for b in bs:
                    tr = req.travel[b[1]]
                    acc.append(round((tr.outbound_min - tr.inter_stop_min) * MIN) * z[vid, t, b])
                for r, var in items:
                    o = order_by_ref[r]
                    if (o.brand == "Fresh") == (kind == "fresh"):
                        tr = req.travel[o.district]
                        acc.append(round((tr.inter_stop_min + o.service_min) * MIN) * var)
            # Fuel km incl. return: Σ_b z·(2·outbound − inter) + Σ_o x·inter.
            for b in buckets:
                tr = req.travel[b[1]]
                km.append(round((2 * tr.outbound_km - tr.inter_stop_km) * KM) * z[vid, t, b])
            for r, var in items:
                km.append(round(req.travel[order_by_ref[r].district].inter_stop_km * KM) * var)
            used = sum(z[vid, t, b] for b in buckets)
            trip_cost.append((50 + int(v.volume_cap_m3)) * used)
        # Rule 7: two separate budgets, max two trips (trip index range), trip 2 only after trip 1.
        m.add(sum(time_fresh) <= req.fresh_budget_min * MIN)
        m.add(sum(time_trading) <= req.trading_budget_min * MIN)
        m.add(sum(km) <= int(max(0.0, v.fuel_remaining_l) * v.km_per_l * KM))
        if req.max_trips >= 2:
            m.add(sum(z[vid, 2, b] for b in buckets) <= sum(z[vid, 1, b] for b in buckets))
            # Fresh runs before the trading day: a Fresh second trip needs a Fresh first trip.
            m.add(sum(z[vid, 2, b] for b in fresh_buckets) <= sum(z[vid, 1, b] for b in fresh_buckets))

    stay_bonus = []
    for ref, (vid, t) in prefs.items():
        if (ref, vid, t) in x:
            stay_bonus.append(40 * x[ref, vid, t])
            m.add_hint(x[ref, vid, t], 1)

    served_value = sum(order_by_ref[ref].priority * var for (ref, _, _), var in x.items())
    m.maximize(served_value * 10 + sum(stay_bonus) - sum(trip_cost))

    solver = cp_model.CpSolver()
    solver.parameters.max_deterministic_time = req.deterministic_time
    solver.parameters.num_workers = 8
    solver.parameters.interleave_search = True  # deterministic with several workers
    solver.parameters.random_seed = 20261004
    status = solver.solve(m)
    elapsed = int((time.perf_counter() - started) * 1000)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return PlanResponse(trips=[], unassigned=[o.ref for o in orders], status=solver.status_name(status), objective=0, solve_ms=elapsed)

    out: list[Trip] = []
    assigned: set[str] = set()
    for v in vehicles:
        for t in trips:
            refs = [r for r, var in by_trip.get((v.vehicle_id, t), []) if solver.value(var)]
            if not refs:
                continue
            first = order_by_ref[refs[0]]
            out.append(Trip(vehicle_id=v.vehicle_id, trip_no=t, brand=first.brand, district=first.district, order_refs=sorted(refs)))
            assigned.update(refs)
    unassigned = [o.ref for o in orders if o.ref not in assigned]
    return PlanResponse(
        trips=out,
        unassigned=unassigned,
        status=solver.status_name(status),
        objective=solver.objective_value,
        solve_ms=elapsed,
    )

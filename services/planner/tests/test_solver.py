from app.model import Order, PlanRequest, Travel, Vehicle
from app.solver import solve, trip_minutes

TRAVEL = {
    "Gampaha": Travel(outbound_min=37, inter_stop_min=9, outbound_km=20, inter_stop_km=4),
    "Colombo": Travel(outbound_min=24, inter_stop_min=8, outbound_km=10, inter_stop_km=3),
}


def order(
    ref,
    district="Colombo",
    brand="Fresh",
    kg=100,
    m3=1.0,
    chilled=False,
    van_only=False,
    svc=16,
    prio=1000,
):
    return Order(
        ref=ref,
        brand=brand,
        district=district,
        chilled=chilled,
        van_only=van_only,
        weight_kg=kg,
        volume_m3=m3,
        service_min=svc,
        priority=prio,
    )


def vehicle(vid, van=False, reefer=True, kg=5000, m3=26.0, fuel=400):
    return Vehicle(
        vehicle_id=vid,
        is_van=van,
        is_reefer=reefer,
        weight_cap_kg=kg,
        volume_cap_m3=m3,
        km_per_l=5,
        fuel_remaining_l=fuel,
    )


def test_booklet_trip_minutes():
    assert trip_minutes(37, 9, [15, 15, 16]) == 101
    assert trip_minutes(24, 8, [16, 16, 16, 16]) == 112
    assert trip_minutes(37, 9, []) == 0


def test_rules_hold_on_a_small_instance():
    orders = [order(f"C{i}", m3=4) for i in range(6)] + [
        order("G1", district="Gampaha", chilled=True)
    ]
    req = PlanRequest(
        date="2026-05-20",
        depot="Peliyagoda",
        orders=orders,
        vehicles=[vehicle("V1", m3=10)],
        travel=TRAVEL,
    )
    res = solve(req)
    assert res.status in ("OPTIMAL", "FEASIBLE")
    assert len(res.trips) <= 2
    by_ref = {o.ref: o for o in orders}
    for t in res.trips:
        assert len({(by_ref[r].brand, by_ref[r].district) for r in t.order_refs}) == 1
        assert sum(by_ref[r].volume_m3 for r in t.order_refs) <= 10
    served = {r for t in res.trips for r in t.order_refs}
    assert served.isdisjoint(res.unassigned)
    assert served | set(res.unassigned) == set(by_ref)


def test_chilled_and_van_only_need_matching_vehicle():
    req = PlanRequest(
        date="2026-05-20",
        depot="Peliyagoda",
        orders=[order("CH", chilled=True), order("VO", van_only=True)],
        vehicles=[vehicle("AMB", reefer=False)],
        travel=TRAVEL,
    )
    res = solve(req)
    assert set(res.unassigned) == {"CH", "VO"}


def test_fresh_budget_limits_trips():
    # 24 + 8×15 + 16×16 = 400 min > 270: not all 16 stops fit one vehicle's Fresh budget.
    orders = [order(f"F{i:02}", m3=0.5) for i in range(16)]
    res = solve(
        PlanRequest(
            date="2026-05-20",
            depot="Peliyagoda",
            orders=orders,
            vehicles=[vehicle("V1")],
            travel=TRAVEL,
        )
    )
    total = 0.0
    for t in res.trips:
        total += trip_minutes(24, 8, [16] * len(t.order_refs))
    assert total <= 270
    assert res.unassigned


def test_priority_wins_scarce_capacity():
    orders = [order("LOW", m3=6, prio=100), order("HIGH", m3=6, prio=5000)]
    res = solve(
        PlanRequest(
            date="2026-05-20",
            depot="Peliyagoda",
            orders=orders,
            vehicles=[vehicle("V1", m3=7)],
            travel=TRAVEL,
            max_trips=1,
        )
    )
    assert res.unassigned == ["LOW"]


def test_deterministic():
    orders = [order(f"C{i}", m3=3 + i % 3, prio=1000 + i) for i in range(12)]
    req = PlanRequest(
        date="2026-05-20",
        depot="Peliyagoda",
        orders=orders,
        vehicles=[vehicle("V1", m3=12), vehicle("V2", m3=8)],
        travel=TRAVEL,
    )
    a, b = solve(req), solve(req)
    assert [t.model_dump() for t in a.trips] == [t.model_dump() for t in b.trips]

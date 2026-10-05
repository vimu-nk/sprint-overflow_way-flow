# Data model

Source of truth: [`apps/api/src/db/schema.ts`](../apps/api/src/db/schema.ts) (Drizzle). Migrations are generated into `apps/api/drizzle/` and committed. 26 tables in three groups: reference data loaded 1:1 from the CSVs, people and security, and the operational day.

## Entity relationships

```mermaid
erDiagram
  outlets ||--o{ orders : "places"
  outlets }o--|| district_travel : "in district"
  vehicles ||--o{ trips : "runs"
  vehicles ||--o{ vehicle_days : "status per date"
  users }o--o| outlets : "store manager of"
  users }o--o| vehicles : "driver of"
  users ||--o{ refresh_tokens : "sessions"
  users ||--o{ notifications : "receives"
  users ||--o{ sync_actions : "sent"
  plans ||--o{ trips : "contains"
  plans ||--o{ plan_versions : "published as"
  plans ||--o{ decisions : "decides"
  orders ||--o{ decisions : "served / deferred"
  trips ||--o{ stops : "visits in sequence"
  orders ||--o{ stops : "delivered by"
  trips ||--o{ load_flags : "shortfalls"
  stops ||--o{ load_flags : "for order"
  trips ||--o{ problem_reports : "driver reports"
  orders ||--o| receipts : "confirmed by store"
  orders ||--o| orders : "carried to next run"
  exceptions }o--o| trips : "about"
  exceptions }o--o| orders : "about"
  attachments }o--|| users : "uploaded by"

  outlets {
    text outlet_id PK
    brand brand
    text district FK
    depot depot
    dock_type dock_type
    parking_constraint parking_constraint
    smallint window_open_min
    smallint window_close_min
    smallint mall_open_min "null if none"
    smallint mall_close_min
    text name "derived: Waypoint Fresh Kandy 7"
  }
  vehicles {
    text vehicle_id PK
    vehicle_type type
    vehicle_temp temp
    real weight_cap_kg
    real volume_cap_m3
    real km_per_l
    real weekly_fuel_quota_l
    depot depot
  }
  orders {
    uuid id PK
    text ref UK "ORD… or S1-…"
    text outlet_id FK
    temp_requirement temp
    int units
    real weight_kg
    real volume_m3
    date run_date
    order_status status
    order_source source "task2b_s1 | synthetic_seed | store_manager"
    bool deferred_yesterday
    smallint days_since_last_served
    uuid carried_from_id
    bool placed_after_cutoff
  }
  plans {
    uuid id PK
    date run_date "unique with depot"
    depot depot
    plan_status status
    int published_version
    jsonb summary
    text engine
  }
  trips {
    uuid id PK
    uuid plan_id FK
    date run_date
    text vehicle_id FK
    smallint trip_no "1 or 2"
    brand brand
    text district FK
    trip_status status
    smallint depart_min
    smallint return_min
    jsonb metrics "kg, m3, minutes, km, fuel"
    timestamptz last_signal_at
    smallint reported_delay_min
    int seen_version
  }
  stops {
    uuid id PK
    uuid trip_id FK
    uuid order_id FK
    smallint seq
    smallint planned_arrival_min
    stop_status status
    bool loaded
    int delivered_units
    failure_reason failure_reason
    text recipient_name
    bool needs_review
  }
  decisions {
    uuid plan_id PK
    uuid order_id PK
    decision decision
    reason_code reason_code
    deferral_class deferral_class
    text explanation
    text store_reason
    bool second_consecutive
    bool acknowledged
  }
```

Not drawn: `calendar_days`, `service_allowances`, `traffic_speeds`, `road_conditions`, `unit_profiles`, `audit_log`, `app_settings`.

## Tables

### Reference data (loaded from `data/source`, read-only for the app role)

| Table | Rows | Natural key | Notes |
| --- | ---: | --- | --- |
| `outlets` | 120 | `outlet_id` | Windows as minutes since midnight; `name` derived from brand, district and position (the CSV has no store names) |
| `vehicles` | 60 | `vehicle_id` | |
| `calendar_days` | 910 | `date` | Operating day, payday, festival + ramp, monsoon |
| `district_travel` | 12 | `district` | Free-flow minutes and km depot→district and between stops |
| `service_allowances` | 9 | `brand, dock_type` | Handling minutes; never hard-coded |
| `traffic_speeds` | 576 | `district, hour, monsoon` | Speed index for ETAs |
| `road_conditions` | 10,920 | `district, date` | Disruption index for ETAs |
| `unit_profiles` | 4 | `brand, temp` | Average kg and m³ per unit from `deliveries_train.csv`, for the store order estimate |

The seed asserts each row count and fails on any unexpected header, number, enum value or time format.

### People and security

| Table | Purpose |
| --- | --- |
| `users` | Email (unique), role, Argon2id hash, scope (`depot`, `outlet_id` or `vehicle_id`, enforced by a check constraint per role), `sessions_valid_after` |
| `refresh_tokens` | Keyed SHA-256 of each refresh token, `family_id` (= session id), idle and absolute expiry, `used_at`, `replaced_by`, `revoked_at` |
| `audit_log` | Append-only (the app role has no UPDATE/DELETE): actor, role, action, entity, details, truncated IP, request id |

### The operational day

| Table | Purpose |
| --- | --- |
| `orders` | One row per order (a Fresh outlet can have a chilled and an ambient order the same day). Status follows the order state machine |
| `plans` | One per run date and depot; working status, published version, summary (served, deferred, limiting resource, engine) |
| `plan_versions` | Snapshot `{tripKey: [orderRefs]}` and diff for every published version (drives the "Plan changed" banners) |
| `vehicle_days` | `available` / `in_workshop` per vehicle and date |
| `trips` | Vehicle, trip 1 or 2, brand, district, status, planned depart/return, metrics snapshot, last signal, reported delay |
| `stops` | One per order on a trip, in sequence: planned arrival, loaded flag, outcome, recipient, location, review flag |
| `decisions` | Served or deferred per order and plan, reason code, unavoidable/choice, explanation, store-facing reason, second-deferral acknowledgement |
| `load_flags` | Loader shortfall or damage (id = the client action id, so photos can be linked offline) |
| `problem_reports` | Driver problems with optional delay |
| `receipts` | Store confirmation or dispute per order |
| `exceptions` | Dispatcher exception queue, code `EX-MMDD-NN` |
| `attachments` | Photo metadata: server-generated object key, type, size, owner, entity link; unique per (uploader, client attachment id) |
| `notifications` | One row per recipient, read state |
| `sync_actions` | Idempotency ledger, unique per (user, client action id), client time and skew flag |
| `app_settings` | Simulation clock anchor |

## Invariants in the database

| Invariant | Mechanism |
| --- | --- |
| ≤ 2 trips per vehicle per day | `check trip_no in (1, 2)` + unique `(run_date, vehicle_id, trip_no)` for non-cancelled trips |
| An order is on at most one live stop | Unique `order_id` for stops not `skipped` |
| A deferred decision has a reason | `check decision = 'served' or reason_code is not null` |
| Positive sizes and capacities | `check` on orders and vehicles |
| One plan per run date and depot | Unique `(run_date, depot)` |
| Role scope present | `check` on users (store manager → outlet, loader → depot, driver → vehicle) |
| Offline action applied once | Unique `(user_id, client_action_id)` |

## Indexes

Orders by `(run_date, status)` and `(outlet_id, run_date)`; trips by plan and by `(run_date, vehicle_id)`; stops by `(trip_id, seq)`; notifications by `(user_id, created_at)` plus a partial index on unread; exceptions by run date; audit by entity and time; attachments by entity.

## Roles

| Role | Used by | Rights |
| --- | --- | --- |
| Owner (`POSTGRES_USER`) | `migrate` job only | DDL, seeding |
| `wayflow_app` | API at runtime | SELECT/INSERT/UPDATE/DELETE on operational tables; SELECT on reference tables; INSERT/SELECT only on `audit_log`; no CREATE |

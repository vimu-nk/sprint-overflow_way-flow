# Screen map: Figma frame → route

| Figma frame (design/) | Route | Role | Notes |
| --- | --- | --- | --- |
| AUTH-01 Login, S0 Sign in (desktop/tablet/phone) | `/` | All | Hero video panel |
| Forgot password form area | `/forgot-password` | All | Admin reset message |
| D4 Live tracking (no signal / reconnected) | `/dispatcher` | Dispatcher | Role home |
| D5 Exception detail | `/dispatcher` (side panel), `/dispatcher/exceptions/$id` | Dispatcher | |
| D1 Order queue | `/dispatcher/queue` | Dispatcher | |
| D2 Plan board (+ blocked, + edit published) | `/dispatcher/plan` | Dispatcher | Move dialog, trip sheet |
| D3 Deferrals & publish (+ published) | `/dispatcher/deferrals` | Dispatcher | |
| D6 Outlook | `/dispatcher/outlook` | Dispatcher | Placeholder |
| — (addition) | `/dispatcher/exceptions`, `/dispatcher/fleet`, `/dispatcher/outlets/$outletId`, `/dispatcher/policy/$planId`, `/dispatcher/trips/$tripId` | Dispatcher | |
| SM1 Place order (+ after cutoff), desktop + phone | `/store` | Store manager | Role home |
| SM2 My deliveries (updates delayed / deferred / issue), desktop + phone | `/store/deliveries` | Store manager | |
| SM3 Confirm receipt (+ report a problem), desktop + phone | `/store/receipt`, `/store/orders/$orderId` | Store manager | |
| L1 Today's loads | `/loader` | Loader | Role home |
| L2 Load list (+ offline, + plan changed) | `/loader/trips/$tripId` | Loader | |
| L3 Report shortfall (+ queued, + sent) | `/loader/flag/$tripId/$stopId` | Loader | |
| DR1 My run (+ offline, + changed, + between trips) | `/driver` | Driver | Role home |
| DR2 Stop detail | `/driver/stops/$stopId` | Driver | |
| DR3 Record delivery (+ partial, + not delivered, + saved offline) | `/driver/record/$stopId` | Driver | |
| DR4 Offline and sync (+ syncing, + reconnected) | `/driver/sync` | Driver | |
| — (addition) | `/driver/report` | Driver | Problem report |
| — (addition) | `/profile` | All | Sessions, password |

## Degradation screens (specs/02 §F)

| Scenario | Screens |
| --- | --- |
| Driver offline mode, pending queue, reconcile | DR1 offline, DR3 saved offline, DR4 offline/syncing/reconnected; D4 "no signal" and reconnected banner; SM2 "updates delayed" |
| Over-capacity day | D2 summary banner (limiting resource), D3 deferrals with unavoidable/choice and store notice, policy write-up, store deferral notice |
| Loading shortfall / vehicle out of service | L3 shortfall (queued, sent), dispatcher critical alert and exception panel, Fleet → workshop re-plan, L2/DR1 "Plan changed" banners |

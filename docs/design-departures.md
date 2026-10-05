# Departures from the Designathon design

Format: **screen** · what changed · why. The Figma exports in `design/` are the reference.

| Screen | What changed | Why |
| --- | --- | --- |
| Sign in (S0, AUTH-01) | Uses the AUTH-01 layout; the green left panel is replaced by the truck video with a dark gradient on the text side | specs/14 and the team's instruction: hero video with text kept legible |
| Sign in | No "Demo Accounts" list, no "Remember me", no "Create account" (AUTH-02) | specs/19: no credentials on the public page, no "remember me" on shared devices, no self-registration |
| Sign in, loader tablet ("Who is loading?") | Not built; loaders sign in with email and password | A public list of loader names and emails would leak account information |
| Forgot password | Shows how to get a reset from the operations administrator | No self-service reset (SEC-09) |
| All screens | Names, IDs, counts and times come from the competition CSVs and the S1 scenario, so they differ from the Figma sample values (e.g. ORD1000134, 19 trips) | No dummy data rule |
| All screens | Green top loader, breadcrumbs below the role home, notification bell with a centre, toasts, skeletons and spinners, sync status pill on field screens | specs/05 global requirements |
| Dispatcher navigation | Adds **Fleet** (vehicle availability, weekly fuel, send to workshop) | D-08/D-09 have no Figma frame |
| Plan board (D2) | Adds per-depot **Run allocation / Re-plan**, a served/deferred summary with the limiting resource, a deferred-orders list with "Place on a trip", a trip detail sheet with **Move**, and **Policy write-up** | D-02, D-04, D-10, D-11 |
| Plan board (D2) | The move flow is a dialog with **Check move** before **Confirm move**; the blocked state uses the D2-blocked copy | The Figma frame shows only the blocked result |
| Deferrals (D3) | Adds an "Unavoidable / Choice" tag and the engine's explanation under each reason | D-05 / specs/03 §8 |
| Live tracking (D4/D5) | Exceptions open in a side panel with **Mark resolved**, **Reschedule** and **Re-plan** actions | D-08 actions |
| Outlook (D6) | Kept as the Figma placeholder with no forecast | The forecast belongs to the Datathon, out of scope |
| Store navigation | Adds an order detail page with a status timeline and cancel-before-cutoff | S-04, S-08 |
| Place order (SM1) | Adds a cutoff countdown chip; Style and Tech outlets get a single "Units" field | S-03; only Fresh orders chilled goods |
| Loader (L2/L3) | Adds a **Missing / Damaged** choice, optional note and photo on the shortfall form; a "Got it" button on the plan-changed banner | L-04 and L-03 acknowledgement |
| Driver | Adds **Report a problem** (delay, breakdown, road closure, access refused) | R-06 has no Figma frame |
| Driver (DR3) | "Not delivered" uses a reason list; location is captured if allowed | R-02, R-03 |
| Profile (all roles) | New page: active sessions, sign out everywhere, change password | SEC-07, SEC-19 |
| Hero video | The supplied video is used as-is; it shows a manufacturer badge on the truck cab | Team asset; should be replaced before a public release (specs/14) |
| Technology | Vite + TanStack Router instead of Next.js; vite-plugin-pwa instead of Serwist; RustFS instead of MinIO; Sonner toasts (the custom toaster file in `design/components/toaster` is empty) | Repository scaffold; see decisions ADR-01 |

import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { act, BASE, Client, PASSWORD } from './client.js';

// Integration suite (specs/17 §2, specs/19 §12). Runs against `docker compose up`; resets the demo first.
const RUN = '2026-05-20';
let disp: Client;
let store: Client;
let otherStore: Client;
let kandyLoader: Client;
let driver: Client;
let otherDriver: Client;
let kandyPlanId: string;

beforeAll(async () => {
  disp = await Client.login('kasun@waypoint.lk');
  expect((await disp.post('/dev/reset', { password: PASSWORD })).status).toBe(200);
  await disp.post('/dev/clock', { date: '2026-05-19', time: '14:00' });
  store = await Client.login('out105@waypoint.lk');
  otherStore = await Client.login('out001@waypoint.lk');
  kandyLoader = await Client.login('kandy-dock@waypoint.lk');
  driver = await Client.login('sampath@waypoint.lk');
  otherDriver = await Client.login('driver.veh041@waypoint.lk');
}, 120_000);

describe('SEC-25/SEC-32 authentication and authorization matrix', () => {
  const routes: [string, string][] = [
    ['GET', '/dispatcher/plans'],
    ['GET', '/dispatcher/orders'],
    ['GET', '/dispatcher/live'],
    ['GET', '/store/home'],
    ['GET', '/loader/trips'],
    ['GET', '/driver/run'],
    ['GET', '/notifications'],
    ['GET', '/clock'],
    ['GET', '/auth/me'],
    ['POST', '/sync/batch'],
    ['POST', '/dev/clock'],
  ];

  it('rejects every protected route without a session', async () => {
    const anon = new Client();
    for (const [m, p] of routes) expect((await anon.req(m, p, m === 'GET' ? undefined : {})).status, `${m} ${p}`).toBe(401);
  });

  it('applies the role matrix', async () => {
    const matrix: [Client, string, number][] = [
      [store, '/dispatcher/plans', 403],
      [driver, '/dispatcher/orders', 403],
      [kandyLoader, '/store/home', 403],
      [driver, '/loader/trips', 403],
      [store, '/driver/run', 403],
      [disp, '/dispatcher/plans', 200],
      [store, '/store/home', 200],
      [kandyLoader, '/loader/trips', 200],
      [driver, '/driver/run', 200],
    ];
    for (const [c, p, s] of matrix) expect((await c.get(p)).status, p).toBe(s);
    expect((await store.post('/dev/clock', { date: '2026-05-19', time: '14:00' })).status).toBe(403);
    expect((await store.post('/sync/batch', { deviceId: 'device-12345', actions: [act({ type: 'trip.start', tripId: crypto.randomUUID() })] })).status).toBe(403);
  });
});

describe('S-03 cutoff (simulation clock)', () => {
  it('15:59 goes to the next run, 16:00 waits for the following run', async () => {
    await disp.post('/dev/clock', { date: '2026-05-19', time: '15:59' });
    const before = await store.post('/store/orders', { chilledUnits: 0, ambientUnits: 5 });
    expect(before.data).toMatchObject({ runDate: '2026-05-20', afterCutoff: false });
    await disp.post('/dev/clock', { date: '2026-05-19', time: '16:00' });
    const after = await store.post('/store/orders', { chilledUnits: 0, ambientUnits: 5 });
    expect(after.data).toMatchObject({ runDate: '2026-05-21', afterCutoff: true });
    await disp.post('/dev/clock', { date: '2026-05-19', time: '14:00' });
  });

  it('places Fresh chilled and ambient orders for the same day with an idempotency key', async () => {
    const key = crypto.randomUUID();
    const a = await store.post('/store/orders', { chilledUnits: 38, ambientUnits: 40, clientActionId: key });
    const b = await store.post('/store/orders', { chilledUnits: 38, ambientUnits: 40, clientActionId: key });
    expect(a.status).toBe(201);
    expect(a.data.orders).toHaveLength(2);
    expect(b.data.orders).toEqual(a.data.orders);
  });
});

describe('planning (D-02…D-06)', () => {
  it('runs both depots with zero violations and explains every deferral', async () => {
    for (const depot of ['Peliyagoda', 'Kandy']) {
      const r = await disp.post('/dispatcher/plans/run', { date: RUN, depot });
      expect(r.status, JSON.stringify(r.data)).toBe(200);
      if (depot === 'Kandy') kandyPlanId = r.data.planId;
      expect(r.data.summary.solveMs).toBeLessThan(5000);
    }
    const q = await disp.get(`/dispatcher/orders?date=${RUN}`);
    const deferred = q.data.orders.filter((o: any) => o.status === 'deferred');
    expect(deferred.length).toBeGreaterThan(0); // S1 is an over-capacity day
    for (const o of deferred) {
      expect(o.decision.reasonCode).toBeTruthy();
      expect(['unavoidable', 'choice']).toContain(o.decision.deferralClass);
      expect(o.decision.storeReason.length).toBeGreaterThan(3);
    }
    // Every order is accounted for exactly once: on a trip or deferred.
    for (const o of q.data.orders.filter((x: any) => x.status !== 'cancelled')) expect(!!o.tripKey !== (o.status === 'deferred')).toBe(true);
  });

  it('blocks a chilled order on an ambient truck with the rule shown, plan unchanged', async () => {
    const q = await disp.get(`/dispatcher/orders?date=${RUN}`);
    const chilled = q.data.orders.find((o: any) => o.temp === 'chilled' && o.outlet.depot === 'Kandy' && o.tripKey);
    const r = await disp.post('/dispatcher/moves', { orderId: chilled.id, vehicleId: 'VEH044', tripNo: 1, reason: 'test move', dryRun: false });
    expect(r.data.ok).toBe(false);
    expect(r.data.violations.map((v: any) => v.rule)).toContain('refrigeration');
    const again = await disp.get(`/dispatcher/orders?date=${RUN}`);
    expect(again.data.orders.find((o: any) => o.id === chilled.id).tripKey).toBe(chilled.tripKey);
  });

  it('defers with a reason and publishes', async () => {
    const q = await disp.get(`/dispatcher/orders?date=${RUN}`);
    const victim = q.data.orders.find((o: any) => o.outlet.depot === 'Kandy' && o.tripKey && !o.deferredYesterday && o.outlet.outletId !== 'OUT105');
    expect((await disp.post('/dispatcher/defer', { orderId: victim.id, reasonCode: 'DISPATCHER_OVERRIDE', reason: 'Outlet asked to skip today' })).status).toBe(204);
    const board = await disp.get(`/dispatcher/plans?date=${RUN}`);
    for (const d of board.data.depots) {
      const r = await disp.post(`/dispatcher/plans/${d.planId}/publish`, { acknowledgeSecondDeferrals: true });
      expect(r.status, JSON.stringify(r.data)).toBe(200);
    }
    const sm = await Client.login(`${victim.outlet.outletId.toLowerCase()}@waypoint.lk`);
    const notes = await sm.get('/notifications');
    expect(notes.data.some((n: any) => n.title.includes(victim.ref) && n.body.includes('Outlet asked to skip today'))).toBe(true);
  });

  it('rejects unknown fields (mass assignment, SEC-27)', async () => {
    const r = await disp.post('/dispatcher/plans/run', { date: RUN, depot: 'Kandy', role: 'admin' });
    expect(r.status).toBe(400);
    expect(r.data.code).toBe('validation_failed');
  });
});

describe('SEC-26 object-level scoping (IDOR)', () => {
  it('store manager cannot read another outlet’s order', async () => {
    const mine = (await store.get('/store/home')).data.orders[0];
    expect((await otherStore.get(`/store/orders/${mine.id}`)).status).toBe(404);
  });

  it('loader cannot open another depot’s trip; driver cannot act on another vehicle', async () => {
    const kandy = (await kandyLoader.get('/loader/trips')).data.trips[0];
    const board = await disp.get(`/dispatcher/plans?date=${RUN}`);
    const pel = board.data.depots.find((d: any) => d.depot === 'Peliyagoda').trips[0];
    expect((await kandyLoader.get(`/loader/trips/${pel.id}`)).status).toBe(404);
    const r = await otherDriver.post('/sync/batch', { deviceId: 'device-other-1', actions: [act({ type: 'trip.start', tripId: kandy.id })] });
    expect(r.data.results[0]).toMatchObject({ status: 'rejected', reason: 'not_found' });
  });
});

describe('field flow, sync and uploads (F4, F5, F10)', () => {
  it('gates start on the loader, applies actions idempotently and keeps order', async () => {
    await disp.post('/dev/clock', { date: RUN, time: '03:15' });
    const run = (await driver.get('/driver/run')).data;
    const trip = run.trips[0];
    const early = await driver.post('/sync/batch', { deviceId: 'phone-sampath-01', actions: [act({ type: 'trip.start', tripId: trip.id })] });
    expect(early.data.results[0]).toMatchObject({ status: 'rejected', reason: 'not_ready' });
    const loads = trip.stops.map((s: any) => act({ type: 'load.check', tripId: trip.id, stopId: s.id, loaded: true }));
    const ready = await kandyLoader.post('/sync/batch', { deviceId: 'dock-tablet-01', actions: [...loads, act({ type: 'load.ready', tripId: trip.id })] });
    expect(ready.data.results.every((r: any) => r.status === 'applied')).toBe(true);
    const start = act({ type: 'trip.start', tripId: trip.id });
    const delivered = act({ type: 'stop.outcome', stopId: trip.stops[0].id, outcome: 'delivered', recipientName: 'Supervisor' });
    const first = await driver.post('/sync/batch', { deviceId: 'phone-sampath-01', actions: [start, delivered] });
    expect(first.data.results.map((r: any) => r.status)).toEqual(['applied', 'applied']);
    const replay = await driver.post('/sync/batch', { deviceId: 'phone-sampath-01', actions: [start, delivered] });
    expect(replay.data.results.map((r: any) => r.status)).toEqual(['duplicate', 'duplicate']);
    // Another user replaying the same client id is checked against their own ledger and scope (SEC-75).
    const probe = await otherDriver.post('/sync/batch', { deviceId: 'phone-x-000001', actions: [delivered] });
    expect(probe.data.results[0].status).toBe('rejected');
    // Proof photo: real image accepted and re-encoded; SVG and oversize rejected (SEC-38).
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#174d3a' } }).png().toBuffer();
    const form = (buf: Buffer | Blob, name = 'p.png') => {
      const f = new FormData();
      f.append('entityType', 'stop');
      f.append('entityId', trip.stops[0].id);
      f.append('clientAttachmentId', crypto.randomUUID());
      f.append('file', buf instanceof Blob ? buf : new Blob([new Uint8Array(buf)]), name);
      return f;
    };
    expect((await driver.req('POST', '/attachments', undefined, { form: form(png) })).status).toBe(201);
    expect((await driver.req('POST', '/attachments', undefined, { form: form(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'x.svg') })).status).toBe(415);
    expect((await driver.req('POST', '/attachments', undefined, { form: form(Buffer.alloc(6 * 1024 * 1024, 1), 'big.jpg') })).status).toBe(413);
    expect((await otherDriver.req('POST', '/attachments', undefined, { form: form(png) })).status).toBe(404);
  });
});

describe('SEC-13/SEC-17/SEC-47 sessions, CSRF and headers', () => {
  it('sets httpOnly SameSite cookies, and logout revokes the session server-side', async () => {
    const c = new Client();
    const r = await c.post('/auth/login', { email: 'out002@waypoint.lk', password: PASSWORD });
    const at = r.cookies.find((x) => /wp_at=/.test(x))!;
    const rt = r.cookies.find((x) => /wp_rt=/.test(x))!;
    expect(at).toMatch(/HttpOnly/i);
    expect(at).toMatch(/SameSite=Lax/i);
    expect(rt).toMatch(/HttpOnly/i);
    expect(rt).toMatch(/SameSite=Strict/i);
    expect(rt).toMatch(/Path=\/api\/v1\/auth/);
    expect(r.data).toEqual({ role: 'store_manager' }); // no tokens or hashes in the body (SEC-29)
    const access = c.jar.get('wp_at')!;
    expect((await c.post('/auth/logout')).status).toBe(204);
    const replay = new Client();
    replay.jar.set('wp_at', access);
    expect((await replay.get('/auth/me')).status).toBe(401);
  });

  it('rejects state-changing requests without the CSRF token or from a hostile origin', async () => {
    expect((await store.req('POST', '/notifications/read-all', {}, { csrf: false })).status).toBe(403);
    expect((await store.req('POST', '/notifications/read-all', {}, { headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect((await store.post('/notifications/read-all')).status).toBe(204);
  });

  it('rotates refresh tokens and revokes the family on reuse (SEC-12)', async () => {
    const c = await Client.login('out003@waypoint.lk');
    const old = c.jar.get('wp_rt')!;
    expect((await c.post('/auth/refresh')).status).toBe(200);
    expect(c.jar.get('wp_rt')).not.toBe(old);
    await new Promise((r) => setTimeout(r, 11_000)); // past the concurrent-tab grace window
    const thief = new Client();
    thief.jar.set('wp_rt', old);
    thief.jar.set('wp_csrf', c.csrf());
    expect((await thief.post('/auth/refresh')).status).toBe(401);
    // The whole family is revoked, including the legitimate new token.
    expect((await c.post('/auth/refresh')).status).toBe(401);
    expect((await c.get('/auth/me')).status).toBe(401);
  }, 30_000);

  it('sends security headers and no-store on API responses; errors leak no stack', async () => {
    const r = await disp.get('/auth/me');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('x-powered-by')).toBeNull();
    expect(r.headers.get('content-security-policy')).toContain("default-src 'none'");
    const bad = await disp.get('/dispatcher/trips/not-a-uuid');
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.data)).not.toMatch(/at \w+ \(|node_modules|SELECT /);
    expect(bad.data.requestId).toBeTruthy();
  });

  it('treats SQL injection payloads as plain text (SEC-35)', async () => {
    const r = await disp.get(`/dispatcher/search?q=${encodeURIComponent("' OR 1=1; DROP TABLE orders; --")}&date=${RUN}`);
    expect(r.status).toBe(200);
    expect(r.data.orders).toEqual([]);
    expect((await disp.get(`/dispatcher/orders?date=${RUN}`)).status).toBe(200);
  });

  it('never returns password or token hashes (SEC-29)', async () => {
    const me = await disp.get('/auth/me');
    expect(JSON.stringify(me.data)).not.toMatch(/argon2|passwordHash|tokenHash/);
  });

  it('health exposes no versions (SEC-56)', async () => {
    const h = await new Client().get('/health');
    expect(Object.keys(h.data).sort()).toEqual(['db', 'planner', 'status', 'storage', 'valkey']);
    void BASE;
    void kandyPlanId;
  });
});

import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';

// The judge walkthrough (README, specs/17 §3) as one end-to-end run over all four roles.
const PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'Waypoint-Demo-2026!';
const RUN = '2026-05-20';

async function login(browser: Browser, email: string, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.fill('#email', email);
  await page.fill('#password', PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(dispatcher|store|loader|driver)/);
  return { ctx, page };
}

/** API call from inside a signed-in page, with its cookies and CSRF token. */
async function call<T>(page: Page, method: string, path: string, body?: unknown): Promise<T> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const csrf = decodeURIComponent(document.cookie.match(/wp_csrf=([^;]+)/)?.[1] ?? '');
      const res = await fetch(`/api/v1${path}`, { method, credentials: 'include', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: body ? JSON.stringify(body) : undefined });
      const text = await res.text();
      if (!res.ok) throw new Error(`${res.status} ${text}`);
      return text ? JSON.parse(text) : null;
    },
    { method, path, body },
  ) as Promise<T>;
}

/** Field device outbox (IndexedDB), for failure messages. */
async function outbox(page: Page) {
  return page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    const name = dbs.find((x) => x.name?.startsWith('wayflow-'))?.name;
    if (!name) return [];
    return new Promise((res) => {
      const r = indexedDB.open(name);
      r.onsuccess = () => {
        const g = r.result.transaction('outbox').objectStore('outbox').getAll();
        g.onsuccess = () => res(g.result.map((o: { status: string; message?: string; action: { type: string } }) => [o.action.type, o.status, o.message]));
      };
    });
  });
}

test('one delivery cycle across all four roles', async ({ browser }) => {
  void ({} as APIRequestContext);
  // 0. Dispatcher resets the demo and sets the clock before the 16:00 cutoff.
  const disp = await login(browser, 'kasun@waypoint.lk');
  await call(disp.page, 'POST', '/dev/reset', { password: PASSWORD });
  await call(disp.page, 'POST', '/dev/clock', { date: '2026-05-19', time: '14:00' });

  // 1. Store manager places a chilled and an ambient order.
  const store = await login(browser, 'out105@waypoint.lk');
  await store.page.goto('/store');
  await store.page.fill('#chilled', '38');
  await store.page.fill('#ambient', '40');
  await expect(store.page.getByText('Goes to the 20 May run')).toBeVisible();
  await store.page.getByRole('button', { name: 'Place order' }).first().click();
  await expect(store.page.getByText(/placed/).first()).toBeVisible();

  // 2–3. Dispatcher sees the queue and runs the allocation for both depots.
  await disp.page.goto(`/dispatcher/queue?date=${RUN}`);
  await expect(disp.page.getByRole('heading', { name: 'Order Queue' })).toBeVisible();
  await disp.page.goto(`/dispatcher/plan?date=${RUN}`);
  for (const depot of ['Peliyagoda', 'Kandy']) {
    await disp.page.getByRole('region', { name: `${depot} Depot` }).getByRole('button', { name: 'Run allocation' }).first().click();
    await expect(disp.page.getByRole('heading', { name: new RegExp(`${depot} Depot \\(\\d+ trips\\)`) })).toBeVisible();
    await expect(disp.page.getByText(new RegExp(`${depot} allocation ready`))).toBeVisible({ timeout: 60_000 });
  }
  await expect(disp.page.getByText(/deferred \(\d+ unavoidable, \d+ by choice\)/)).toBeVisible();

  // 4. A chilled order onto an ambient truck is blocked with the rule shown.
  const queue = await call<{ orders: { id: string; temp: string; tripKey: string | null; outlet: { depot: string } }[] }>(disp.page, 'GET', `/dispatcher/orders?date=${RUN}`);
  const chilled = queue.orders.find((o) => o.temp === 'chilled' && o.outlet.depot === 'Kandy' && o.tripKey)!;
  const blocked = await call<{ ok: boolean; message: string }>(disp.page, 'POST', '/dispatcher/moves', { orderId: chilled.id, vehicleId: 'VEH044', tripNo: 1, reason: 'Walkthrough check', dryRun: true });
  expect(blocked.ok).toBe(false);
  expect(blocked.message).toMatch(/not refrigerated/);

  // 6. Publish (acknowledging second deferrals) and see the published state.
  await disp.page.getByRole('button', { name: 'Publish plan' }).click();
  const ack = disp.page.getByRole('button', { name: 'Acknowledge and publish' });
  const published = disp.page.getByText('Plan published. A change is republished');
  await expect(ack.or(published)).toBeVisible({ timeout: 30_000 });
  if (await ack.isVisible()) await ack.click();
  await expect(disp.page.getByText('Plan published. A change is republished')).toBeVisible({ timeout: 30_000 });

  // 7. Store sees the orders scheduled with a planned arrival.
  await store.page.goto('/store/deliveries');
  await expect(store.page.getByText('Scheduled').first()).toBeVisible();

  // 8–11. Loader (Kandy) loads the driver's trip in reverse stop order and marks it loaded.
  await call(disp.page, 'POST', '/dev/clock', { date: RUN, time: '03:15' });
  const driverRun = await (async () => {
    const d = await login(browser, 'sampath@waypoint.lk', { width: 390, height: 844 });
    const run = await call<{ trips: { id: string; key: string }[] }>(d.page, 'GET', '/driver/run');
    return { ...d, run };
  })();
  test.skip(!driverRun.run.trips.length, 'VEH040 has no trip in this plan');
  const trip = driverRun.run.trips[0]!;
  const loader = await login(browser, 'kandy-dock@waypoint.lk', { width: 768, height: 1024 });
  await loader.page.goto(`/loader/trips/${trip.id}`);
  await expect(loader.page.getByText('Load in this order, last stop first')).toBeVisible();
  const boxes = loader.page.getByRole('checkbox');
  const n = await boxes.count();
  for (let i = 0; i < n; i++) await boxes.nth(i).click();
  await loader.page.getByRole('button', { name: 'Mark loaded', exact: true }).click();
  await expect(loader.page.getByText('Online · synced')).toBeVisible({ timeout: 20_000 });

  // 12. Driver starts the trip.
  const dp = driverRun.page;
  await dp.goto('/driver');
  await dp.getByRole('button', { name: /Start trip/ }).click();
  await expect(dp.getByRole('button', { name: 'Record delivery' })).toBeVisible();
  await expect(dp.getByText('Online · synced'), JSON.stringify(await outbox(dp))).toBeVisible({ timeout: 20_000 });

  // 13. Driver goes offline and records two stops.
  await driverRun.ctx.setOffline(true);
  for (let i = 0; i < 2; i++) {
    await dp.getByRole('button', { name: 'Record delivery' }).click();
    await dp.screenshot({ path: `test-results/record-${i}.png` });
    await dp.fill('#rd-recipient', 'Store supervisor');
    await dp.getByRole('button', { name: 'Save delivery' }).click();
    await expect(dp.getByText(/Saved on this device/)).toBeVisible();
    await dp.getByRole('button', { name: 'Back to run' }).click();
  }
  await expect(dp.getByText(/Offline · 2 pending/)).toBeVisible();
  // The run sheet survives a reload while offline (specs/08 §7 test 1). Needs the service worker,
  // which only the production build registers, so this runs against the stack (E2E_BASE_URL).
  if (process.env.E2E_BASE_URL) {
    await dp.reload();
    await expect(dp.getByRole('heading', { name: 'My Run' })).toBeVisible();
    await expect(dp.getByText('Not synced yet').first()).toBeVisible();
  }

  // 14. Back online: the outbox drains and the office sees the deliveries.
  await driverRun.ctx.setOffline(false);
  await dp.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(dp.getByText('Online · synced')).toBeVisible({ timeout: 30_000 });

  // 15. Dispatcher live board shows the deliveries.
  await disp.page.goto(`/dispatcher?date=${RUN}`);
  const live = await call<{ kpis: { delivered: number } }>(disp.page, 'GET', `/dispatcher/live?date=${RUN}`);
  expect(live.kpis.delivered).toBeGreaterThanOrEqual(2);

  for (const c of [disp, store, loader, driverRun]) await c.ctx.close();
});

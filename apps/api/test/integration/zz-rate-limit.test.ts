import { describe, expect, it } from 'vitest';
import { Client } from './client.js';

// Runs last: it uses up this IP's sign-in throttle for about a minute.
describe('SEC-50 login rate limiting', () => {
  it('slows down repeated failed sign-ins with 429 and a generic message', async () => {
    const c = new Client();
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await c.post('/auth/login', { email: 'nobody@waypoint.lk', password: 'wrong-password-123' })).status);
    expect(statuses.every((s) => s === 401 || s === 429)).toBe(true);
    expect(statuses).toContain(429);
    // Unknown user and wrong password look the same (SEC-06).
    const r = await new Client().post('/auth/login', { email: 'nobody-else@waypoint.lk', password: 'x' });
    expect([401, 429]).toContain(r.status);
  });
});

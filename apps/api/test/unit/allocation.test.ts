import { validateAllocation } from '@wayflow/shared';
import { describe, expect, it } from 'vitest';
import { enforceMallWindows, explainDeferral, greedyAllocate, repair } from '../../src/planning/allocation.js';
import { ctx, order, outlet, vehicle } from './fixtures.js';

describe('greedy fallback engine', () => {
  it('produces a plan with zero rule violations and every order once', () => {
    const outlets = Array.from({ length: 12 }, (_, i) => outlet(`O${i}`, { parkingConstraint: i % 4 === 0 ? 'van_only' : 'normal' }));
    const orders = outlets.flatMap((o, i) => [order(`A${i}`, o.outletId, { volumeM3: 3 }), order(`C${i}`, o.outletId, { temp: 'chilled', volumeM3: 2, priority: 3000 })]);
    const c = ctx(outlets, orders, [vehicle('V1', { volumeCapM3: 10 }), vehicle('V2', { temp: 'ambient' }), vehicle('V3', { type: 'van', volumeCapM3: 7, weightCapKg: 1040 })]);
    const trips = greedyAllocate(c, orders);
    expect(validateAllocation(trips, c)).toEqual([]);
    const refs = trips.flatMap((t) => t.orderRefs);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it('serves higher priority first when capacity is short', () => {
    const outlets = [outlet('A'), outlet('B')];
    const orders = [order('LOW', 'A', { volumeM3: 6, priority: 100 }), order('HIGH', 'B', { volumeM3: 6, priority: 9000 })];
    const c = ctx(outlets, orders, [vehicle('V1', { volumeCapM3: 7 })]);
    // One vehicle, two trips allowed; restrict the second trip with the Fresh budget by many stops.
    const trips = greedyAllocate(c, orders);
    expect(trips.flatMap((t) => t.orderRefs)).toContain('HIGH');
  });

  it('is deterministic', () => {
    const outlets = Array.from({ length: 8 }, (_, i) => outlet(`O${i}`));
    const orders = outlets.map((o, i) => order(`R${i}`, o.outletId, { volumeM3: 2 + (i % 3), priority: 1000 + i }));
    const c = ctx(outlets, orders, [vehicle('V1', { volumeCapM3: 9 }), vehicle('V2', { volumeCapM3: 6 })]);
    expect(greedyAllocate(c, orders)).toEqual(greedyAllocate(c, orders));
  });
});

describe('repair and mall windows', () => {
  it('repair inserts a deferred order that fits', () => {
    const c = ctx([outlet('A'), outlet('B')], [order('X', 'A'), order('Y', 'B')], [vehicle('V1')]);
    const out = repair(c, [{ vehicleId: 'V1', tripNo: 1, orderRefs: ['X'] }], [c.orders.get('Y') as never]);
    expect(out.flatMap((t) => t.orderRefs).sort()).toEqual(['X', 'Y']);
  });

  it('removes the lowest-priority order that breaks a mall window', () => {
    const mall = (id: string) => outlet(id, { brand: 'Style', dockType: 'mall_bay', parkingConstraint: 'mall_dock', windowOpenMin: 540, windowCloseMin: 1020, mallOpenMin: 540, mallCloseMin: 660 });
    const outlets = [mall('M1'), mall('M2'), mall('M3')];
    const orders = outlets.map((o, i) => order(o.outletId, o.outletId, { brand: 'Style', priority: 1000 + i }));
    const c = ctx(outlets, orders, [vehicle('V1')]);
    const { trips, removed } = enforceMallWindows(c, [{ vehicleId: 'V1', tripNo: 1, orderRefs: ['M1', 'M2', 'M3'] }], new Map(orders.map((o) => [o.ref, o.priority])));
    expect(removed).toEqual(['M1']);
    expect(validateAllocation(trips, c)).toEqual([]);
  });
});

describe('deferral explanations', () => {
  it('chilled order with no reefer in the depot is unavoidable', () => {
    const c = ctx([outlet('A')], [order('C', 'A', { temp: 'chilled' })], [vehicle('V1', { temp: 'ambient' })]);
    expect(explainDeferral(c, [], c.orders.get('C') as never)).toMatchObject({ reasonCode: 'NO_REEFER_CAPACITY', deferralClass: 'unavoidable' });
  });

  it('every compatible vehicle in the workshop gives VEHICLE_UNAVAILABLE', () => {
    const c = ctx([outlet('A')], [order('C', 'A', { temp: 'chilled' })], [vehicle('V1', { status: 'in_workshop' }), vehicle('V2', { temp: 'ambient' })]);
    const e = explainDeferral(c, [], c.orders.get('C') as never);
    expect(e).toMatchObject({ reasonCode: 'VEHICLE_UNAVAILABLE', deferralClass: 'unavoidable' });
    expect(e.explanation).toContain('V1');
  });

  it('order too big for any compatible vehicle is unavoidable', () => {
    const c = ctx([outlet('V', { parkingConstraint: 'van_only' })], [order('BIG', 'V', { volumeM3: 9 })], [vehicle('VAN', { type: 'van', volumeCapM3: 7, temp: 'ambient' })]);
    expect(explainDeferral(c, [], c.orders.get('BIG') as never)).toMatchObject({ deferralClass: 'unavoidable', reasonCode: 'NO_VAN_CAPACITY' });
  });

  it('capacity given to other orders is a choice, with the scarce-fleet reason', () => {
    const outlets = [outlet('A'), outlet('B'), outlet('C')];
    const orders = [order('O1', 'A', { temp: 'chilled', volumeM3: 6 }), order('O2', 'B', { temp: 'chilled', volumeM3: 6 }), order('O3', 'C', { temp: 'chilled', volumeM3: 6 })];
    const c = ctx(outlets, orders, [vehicle('V1', { volumeCapM3: 6 })]);
    const trips = [
      { vehicleId: 'V1', tripNo: 1, orderRefs: ['O1'] },
      { vehicleId: 'V1', tripNo: 2, orderRefs: ['O2'] },
    ];
    expect(explainDeferral(c, trips, c.orders.get('O3') as never)).toMatchObject({ deferralClass: 'choice', reasonCode: 'NO_REEFER_CAPACITY' });
  });

  it('a mall-window removal is WINDOW_INFEASIBLE', () => {
    const c = ctx([outlet('A')], [order('M', 'A')], [vehicle('V1')]);
    expect(explainDeferral(c, [], c.orders.get('M') as never, true).reasonCode).toBe('WINDOW_INFEASIBLE');
  });
});

import { describe, expect, it } from 'vitest';
import {
  assertTransition,
  canTransition,
  ORDER_TRANSITIONS,
  scheduleTrip,
  sequenceStops,
  serviceAllowance,
  STOP_TRANSITIONS,
  TransitionError,
  TRIP_TRANSITIONS,
  tripMinutes,
  validateAllocation,
} from '../src/index.js';
import { allowance, colombo, context, gampaha, order, outlet, vehicle } from './fixtures.js';

describe('trip-time formula (booklet worked example)', () => {
  it('Fresh Gampaha trip with 3 orders = 101 min', () => {
    const h = ['rear_dock', 'rear_dock', 'street'].map((d) => serviceAllowance(allowance, 'Fresh', d as never));
    expect(tripMinutes(gampaha, h)).toEqual({ outbound: 37, interStop: 18, handling: 46, total: 101 });
  });

  it('Fresh Colombo trip with 4 street stops = 112 min', () => {
    expect(tripMinutes(colombo, [16, 16, 16, 16]).total).toBe(112);
  });

  it('two trips use 213 of 270 and a third trip is rejected', () => {
    const outlets = [
      outlet('G1', { district: 'Gampaha', dockType: 'rear_dock' }),
      outlet('G2', { district: 'Gampaha', dockType: 'rear_dock' }),
      outlet('G3', { district: 'Gampaha', dockType: 'street' }),
      outlet('C1'),
      outlet('C2'),
      outlet('C3'),
      outlet('C4'),
      outlet('C5'),
    ];
    const orders = outlets.map((o, i) => order(`O${i}`, o.outletId));
    const ctx = context(outlets, orders, [vehicle('VEH001')]);
    const two = [
      { vehicleId: 'VEH001', tripNo: 1, orderRefs: ['O0', 'O1', 'O2'] },
      { vehicleId: 'VEH001', tripNo: 2, orderRefs: ['O3', 'O4', 'O5', 'O6'] },
    ];
    expect(validateAllocation(two, ctx)).toEqual([]);
    const three = [...two, { vehicleId: 'VEH001', tripNo: 3, orderRefs: ['O7'] }];
    expect(validateAllocation(three, ctx).map((v) => v.rule)).toContain('trip_limit');
  });

  it('empty trip takes no time', () => {
    expect(tripMinutes(colombo, []).total).toBe(0);
  });
});

describe('feasibility rules', () => {
  const base = () => {
    const outlets = [outlet('A'), outlet('B'), outlet('V', { parkingConstraint: 'van_only' })];
    return { outlets };
  };

  it('rule 1: a trip serves one brand in one district', () => {
    const outlets = [outlet('A'), outlet('G', { district: 'Gampaha' })];
    const ctx = context(outlets, [order('O1', 'A'), order('O2', 'G')], [vehicle('VEH001')]);
    const v = validateAllocation([{ vehicleId: 'VEH001', tripNo: 1, orderRefs: ['O1', 'O2'] }], ctx);
    expect(v.map((x) => x.rule)).toContain('brand_district');
  });

  it('rule 1: mixing brands in the same district is blocked', () => {
    const outlets = [outlet('A'), outlet('S', { brand: 'Style', windowOpenMin: 540, windowCloseMin: 1020 })];
    const ctx = context(outlets, [order('O1', 'A'), order('O2', 'S', { brand: 'Style' })], [vehicle('VEH001')]);
    const v = validateAllocation([{ vehicleId: 'VEH001', tripNo: 1, orderRefs: ['O1', 'O2'] }], ctx);
    expect(v.map((x) => x.rule)).toContain('brand_district');
  });

  it('rule 2: chilled goods need a reefer, ambient goods may ride a reefer', () => {
    const { outlets } = base();
    const ctx = context(
      outlets,
      [order('C', 'A', { temp: 'chilled' }), order('D', 'B')],
      [vehicle('AMB', { temp: 'ambient' }), vehicle('REF')],
    );
    expect(validateAllocation([{ vehicleId: 'AMB', tripNo: 1, orderRefs: ['C'] }], ctx).map((x) => x.rule)).toContain(
      'refrigeration',
    );
    expect(validateAllocation([{ vehicleId: 'REF', tripNo: 1, orderRefs: ['C', 'D'] }], ctx)).toEqual([]);
  });

  it('rule 3: van-only outlets cannot take a truck', () => {
    const { outlets } = base();
    const ctx = context(outlets, [order('O', 'V')], [vehicle('TRK'), vehicle('VAN', { type: 'van', weightCapKg: 1040, volumeCapM3: 7 })]);
    expect(validateAllocation([{ vehicleId: 'TRK', tripNo: 1, orderRefs: ['O'] }], ctx).map((x) => x.rule)).toContain('access');
    expect(validateAllocation([{ vehicleId: 'VAN', tripNo: 1, orderRefs: ['O'] }], ctx)).toEqual([]);
  });

  it('rule 4: a vehicle serves only its home depot', () => {
    const { outlets } = base();
    const ctx = context(outlets, [order('O', 'A')], [vehicle('K', { depot: 'Kandy' })]);
    expect(validateAllocation([{ vehicleId: 'K', tripNo: 1, orderRefs: ['O'] }], ctx).map((x) => x.rule)).toContain(
      'home_depot',
    );
  });

  it('rule 5: an order cannot be on two trips', () => {
    const { outlets } = base();
    const ctx = context(outlets, [order('O', 'A')], [vehicle('VEH001'), vehicle('VEH002')]);
    const v = validateAllocation(
      [
        { vehicleId: 'VEH001', tripNo: 1, orderRefs: ['O'] },
        { vehicleId: 'VEH002', tripNo: 1, orderRefs: ['O'] },
      ],
      ctx,
    );
    expect(v.map((x) => x.rule)).toContain('whole_orders');
  });

  it('rule 6: weight and volume are both checked', () => {
    const { outlets } = base();
    const heavy = context(outlets, [order('O', 'A', { weightKg: 1100, volumeM3: 1 })], [vehicle('VAN', { weightCapKg: 1040, volumeCapM3: 7 })]);
    expect(validateAllocation([{ vehicleId: 'VAN', tripNo: 1, orderRefs: ['O'] }], heavy).map((x) => x.rule)).toEqual([
      'capacity_weight',
    ]);
    const bulky = context(outlets, [order('O', 'A', { weightKg: 300, volumeM3: 8.8 })], [vehicle('VAN', { weightCapKg: 1040, volumeCapM3: 7 })]);
    expect(validateAllocation([{ vehicleId: 'VAN', tripNo: 1, orderRefs: ['O'] }], bulky).map((x) => x.rule)).toEqual([
      'capacity_volume',
    ]);
  });

  it('rule 7: Fresh (270) and Style + Tech (480) budgets are separate', () => {
    const fresh = Array.from({ length: 16 }, (_, i) => outlet(`F${i}`));
    const style = [outlet('S1', { brand: 'Style', dockType: 'rear_dock', windowOpenMin: 540, windowCloseMin: 1020 })];
    const orders = [...fresh.map((o) => order(o.outletId, o.outletId)), order('S1', 'S1', { brand: 'Style' })];
    const ctx = context([...fresh, ...style], orders, [vehicle('VEH001')]);
    // 24 + 8×15 + 16×16 = 400 > 270
    const v = validateAllocation([{ vehicleId: 'VEH001', tripNo: 1, orderRefs: fresh.map((o) => o.outletId) }], ctx);
    expect(v.map((x) => x.rule)).toContain('time_budget');
    // 10 Fresh stops (24 + 72 + 160 = 256) plus one Style trip both fit their own budgets.
    const ok = validateAllocation(
      [
        { vehicleId: 'VEH001', tripNo: 1, orderRefs: fresh.slice(0, 10).map((o) => o.outletId) },
        { vehicleId: 'VEH001', tripNo: 2, orderRefs: ['S1'] },
      ],
      ctx,
    );
    expect(ok).toEqual([]);
  });

  it('weekly fuel quota is enforced', () => {
    const { outlets } = base();
    const ctx = context(outlets, [order('O', 'A')], [vehicle('VEH001', { weeklyFuelQuotaL: 100 })], {
      fuelUsedL: new Map([['VEH001', 97]]),
    });
    // 2 × 10 km / 5 km/L = 4 L > 3 L left
    expect(validateAllocation([{ vehicleId: 'VEH001', tripNo: 1, orderRefs: ['O'] }], ctx).map((x) => x.rule)).toEqual([
      'fuel_quota',
    ]);
  });

  it('workshop vehicles are never allocated', () => {
    const { outlets } = base();
    const ctx = context(outlets, [order('O', 'A')], [vehicle('VEH001', { status: 'in_workshop' })]);
    expect(validateAllocation([{ vehicleId: 'VEH001', tripNo: 1, orderRefs: ['O'] }], ctx).map((x) => x.rule)).toContain(
      'vehicle_unavailable',
    );
  });

  it('non-operating days take no deliveries', () => {
    const { outlets } = base();
    const ctx = context(outlets, [order('O', 'A')], [vehicle('VEH001')], { isOperatingDay: false });
    expect(validateAllocation([{ vehicleId: 'VEH001', tripNo: 1, orderRefs: ['O'] }], ctx).map((x) => x.rule)).toContain(
      'operating_day',
    );
  });

  it('mall outlets only accept goods inside the mall window', () => {
    const mall = (id: string) =>
      outlet(id, {
        brand: 'Style',
        dockType: 'mall_bay',
        parkingConstraint: 'mall_dock',
        windowOpenMin: 540,
        windowCloseMin: 1020,
        mallOpenMin: 540,
        mallCloseMin: 660,
      });
    const outlets = [mall('M1'), mall('M2'), mall('M3')];
    const orders = outlets.map((o) => order(o.outletId, o.outletId, { brand: 'Style' }));
    const ctx = context(outlets, orders, [vehicle('VEH001')]);
    // 09:00 arrival, 3 × 59 min handling + 2 × 8 travel: the third stop starts after 11:00.
    const v = validateAllocation([{ vehicleId: 'VEH001', tripNo: 1, orderRefs: ['M1', 'M2', 'M3'] }], ctx);
    expect(v.map((x) => x.rule)).toContain('mall_window');
    expect(validateAllocation([{ vehicleId: 'VEH001', tripNo: 1, orderRefs: ['M1', 'M2'] }], ctx)).toEqual([]);
  });
});

describe('sequencing and schedule', () => {
  it('orders stops by window close and keeps same-outlet orders together', () => {
    const a = outlet('A', { windowCloseMin: 480 });
    const b = outlet('B', { windowCloseMin: 450, dockType: 'rear_dock' });
    const items = [
      { order: order('1', 'A'), outlet: a },
      { order: order('2', 'B'), outlet: b },
      { order: order('3', 'A', { temp: 'chilled' }), outlet: a },
    ];
    expect(sequenceStops(items).map((i) => i.order.ref)).toEqual(['2', '3', '1']);
  });

  it('waits for the window to open and flags late arrivals', () => {
    const a = outlet('A', { windowOpenMin: 300, windowCloseMin: 270 + 30 });
    const s = scheduleTrip([{ order: order('1', 'A'), outlet: a }], colombo, [16]);
    expect(s.departMin).toBe(276); // 05:00 window − 24 min outbound
    expect(s.stops[0]!.arrivalMin).toBe(300);
    const late = scheduleTrip([{ order: order('1', 'A'), outlet: outlet('A', { windowOpenMin: 200, windowCloseMin: 220 }) }], colombo, [16]);
    expect(late.stops[0]!.late).toBe(true);
  });
});

describe('state machines', () => {
  it('allows legal order transitions for the right role only', () => {
    expect(canTransition(ORDER_TRANSITIONS, 'draft', 'confirmed', 'store_manager')).toBe(true);
    expect(canTransition(ORDER_TRANSITIONS, 'draft', 'confirmed', 'driver')).toBe(false);
    expect(canTransition(ORDER_TRANSITIONS, 'published', 'loaded', 'loader')).toBe(true);
    expect(canTransition(ORDER_TRANSITIONS, 'loaded', 'departed', 'driver')).toBe(true);
    expect(canTransition(ORDER_TRANSITIONS, 'delivered', 'received', 'store_manager')).toBe(true);
  });

  it('rejects illegal transitions', () => {
    expect(() => assertTransition('Order', ORDER_TRANSITIONS, 'confirmed', 'delivered', 'driver')).toThrow(TransitionError);
    expect(() => assertTransition('Trip', TRIP_TRANSITIONS, 'planned', 'departed', 'driver')).toThrow(TransitionError);
    expect(() => assertTransition('Stop', STOP_TRANSITIONS, 'delivered', 'failed', 'driver')).toThrow(TransitionError);
    expect(canTransition(TRIP_TRANSITIONS, 'ready', 'departed', 'loader')).toBe(false);
  });
});

import type { AllocationContext, RuleOutlet, RuleVehicle } from '@wayflow/shared';
import type { PlanOrder } from '../../src/planning/allocation.js';

export const allowance = { 'Fresh|rear_dock': 15, 'Fresh|street': 16, 'Fresh|mall_bay': 18, 'Style|rear_dock': 38, 'Style|street': 46, 'Style|mall_bay': 59, 'Tech|rear_dock': 43, 'Tech|street': 55, 'Tech|mall_bay': 55 };

export const outlet = (id: string, p: Partial<RuleOutlet> = {}): RuleOutlet => ({
  outletId: id, brand: 'Fresh', district: 'Colombo', depot: 'Peliyagoda', dockType: 'street', parkingConstraint: 'normal',
  windowOpenMin: 300, windowCloseMin: 450, mallOpenMin: null, mallCloseMin: null, ...p,
});
export const order = (ref: string, outletId: string, p: Partial<PlanOrder> = {}): PlanOrder => ({ ref, outletId, brand: 'Fresh', temp: 'ambient', weightKg: 100, volumeM3: 1, priority: 1000, ...p });
export const vehicle = (id: string, p: Partial<RuleVehicle> = {}): RuleVehicle => ({
  vehicleId: id, type: 'truck', temp: 'reefer', weightCapKg: 5000, volumeCapM3: 26, kmPerL: 5, weeklyFuelQuotaL: 400, depot: 'Peliyagoda', status: 'available', ...p,
});
export function ctx(outlets: RuleOutlet[], orders: PlanOrder[], vehicles: RuleVehicle[]): AllocationContext {
  return {
    date: '2026-05-20',
    isOperatingDay: true,
    orders: new Map(orders.map((o) => [o.ref, o])),
    outlets: new Map(outlets.map((o) => [o.outletId, o])),
    vehicles: new Map(vehicles.map((v) => [v.vehicleId, v])),
    travel: new Map([['Colombo', { district: 'Colombo', depot: 'Peliyagoda', depotToDistrictKm: 10, depotToDistrictFreeflowMin: 24, interStopKm: 3, interStopFreeflowMin: 8 }]]),
    allowance,
    fuelUsedL: new Map(),
  };
}

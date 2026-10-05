import type { AllocationContext, RuleDistrictTravel, RuleOrder, RuleOutlet, RuleVehicle } from '../src/index.js';

// Small hand-built fixtures. Numbers for Gampaha/Colombo and the allowance table are the
// booklet's worked example (Challenge Booklet p.20), not copied dataset rows.
export const allowance = {
  'Fresh|rear_dock': 15,
  'Fresh|street': 16,
  'Fresh|mall_bay': 18,
  'Style|rear_dock': 38,
  'Style|street': 46,
  'Style|mall_bay': 59,
  'Tech|rear_dock': 43,
  'Tech|street': 55,
  'Tech|mall_bay': 55,
};

export const gampaha: RuleDistrictTravel = {
  district: 'Gampaha',
  depot: 'Peliyagoda',
  depotToDistrictKm: 20,
  depotToDistrictFreeflowMin: 37,
  interStopKm: 4,
  interStopFreeflowMin: 9,
};
export const colombo: RuleDistrictTravel = {
  district: 'Colombo',
  depot: 'Peliyagoda',
  depotToDistrictKm: 10,
  depotToDistrictFreeflowMin: 24,
  interStopKm: 3,
  interStopFreeflowMin: 8,
};

export function outlet(id: string, p: Partial<RuleOutlet> = {}): RuleOutlet {
  return {
    outletId: id,
    brand: 'Fresh',
    district: 'Colombo',
    depot: 'Peliyagoda',
    dockType: 'street',
    parkingConstraint: 'normal',
    windowOpenMin: 300,
    windowCloseMin: 450,
    mallOpenMin: null,
    mallCloseMin: null,
    ...p,
  };
}

export function order(ref: string, outletId: string, p: Partial<RuleOrder> = {}): RuleOrder {
  return { ref, outletId, brand: 'Fresh', temp: 'ambient', weightKg: 100, volumeM3: 1, ...p };
}

export function vehicle(id: string, p: Partial<RuleVehicle> = {}): RuleVehicle {
  return {
    vehicleId: id,
    type: 'truck',
    temp: 'reefer',
    weightCapKg: 5000,
    volumeCapM3: 26,
    kmPerL: 5,
    weeklyFuelQuotaL: 400,
    depot: 'Peliyagoda',
    status: 'available',
    ...p,
  };
}

export function context(
  outlets: RuleOutlet[],
  orders: RuleOrder[],
  vehicles: RuleVehicle[],
  extra: Partial<AllocationContext> = {},
): AllocationContext {
  return {
    date: '2026-05-20',
    isOperatingDay: true,
    orders: new Map(orders.map((o) => [o.ref, o])),
    outlets: new Map(outlets.map((o) => [o.outletId, o])),
    vehicles: new Map(vehicles.map((v) => [v.vehicleId, v])),
    travel: new Map([
      ['Gampaha', gampaha],
      ['Colombo', colombo],
    ]),
    allowance,
    fuelUsedL: new Map(),
    ...extra,
  };
}

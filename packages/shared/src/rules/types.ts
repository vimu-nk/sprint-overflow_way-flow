import type {
  Brand,
  Depot,
  DockType,
  ParkingConstraint,
  TempRequirement,
  VehicleDayStatus,
  VehicleTemp,
  VehicleType,
} from '../enums.js';

/** Plain inputs for the pure rule functions. Times are minutes since midnight. */
export interface RuleOutlet {
  outletId: string;
  brand: Brand;
  district: string;
  depot: Depot;
  dockType: DockType;
  parkingConstraint: ParkingConstraint;
  windowOpenMin: number;
  windowCloseMin: number;
  mallOpenMin: number | null;
  mallCloseMin: number | null;
}

export interface RuleOrder {
  ref: string;
  outletId: string;
  brand: Brand;
  temp: TempRequirement;
  weightKg: number;
  volumeM3: number;
}

export interface RuleVehicle {
  vehicleId: string;
  type: VehicleType;
  temp: VehicleTemp;
  weightCapKg: number;
  volumeCapM3: number;
  kmPerL: number;
  weeklyFuelQuotaL: number;
  depot: Depot;
  status: VehicleDayStatus;
}

export interface RuleDistrictTravel {
  district: string;
  depot: Depot;
  depotToDistrictKm: number;
  depotToDistrictFreeflowMin: number;
  interStopKm: number;
  interStopFreeflowMin: number;
}

/** service_allowance.csv keyed as `${brand}|${dockType}`. */
export type AllowanceTable = Record<string, number>;

export interface AllocationTrip {
  vehicleId: string;
  tripNo: number;
  /** Order references in stop sequence. */
  orderRefs: string[];
}

export interface AllocationContext {
  date: string;
  isOperatingDay: boolean;
  orders: Map<string, RuleOrder>;
  outlets: Map<string, RuleOutlet>;
  vehicles: Map<string, RuleVehicle>;
  travel: Map<string, RuleDistrictTravel>;
  allowance: AllowanceTable;
  /** Litres already committed this ISO week before this plan, per vehicle. */
  fuelUsedL: Map<string, number>;
}

export type RuleId =
  | 'operating_day'
  | 'brand_district'
  | 'refrigeration'
  | 'access'
  | 'home_depot'
  | 'whole_orders'
  | 'capacity_weight'
  | 'capacity_volume'
  | 'trip_limit'
  | 'time_budget'
  | 'fuel_quota'
  | 'vehicle_unavailable'
  | 'mall_window'
  | 'unknown_reference';

export interface Violation {
  rule: RuleId;
  /** `${vehicleId}-T${tripNo}` */
  tripKey?: string;
  orderRef?: string;
  message: string;
  details?: Record<string, number | string>;
}

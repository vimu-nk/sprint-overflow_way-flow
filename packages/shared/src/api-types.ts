// Response shapes returned by the API. Explicit allow-lists: no entity spreading (SEC-29).
import type {
  Brand,
  DeferralClass,
  Depot,
  DockType,
  ExceptionType,
  FailureReason,
  OrderStatus,
  ParkingConstraint,
  PlanStatus,
  ProblemKind,
  ReasonCode,
  Role,
  Severity,
  StopStatus,
  TempRequirement,
  TripStatus,
  VehicleDayStatus,
  VehicleTemp,
  VehicleType,
} from './enums.js';

export interface ClockDto {
  now: string;
  date: string;
  time: string;
  /** Run date an order placed now goes to. */
  orderRunDate: string;
  /** Next operating run after today (what the dispatcher plans). */
  planningRunDate: string;
  minutesToCutoff: number;
  outsideCalendar: boolean;
  demoTools: boolean;
  calendar: { isPayday: boolean; festival: string | null; festivalRamp: number; monsoon: boolean; isOperating: boolean } | null;
}

export interface MeDto {
  id: string;
  email: string;
  name: string;
  role: Role;
  depot: Depot | null;
  vehicleId: string | null;
  outlet: { outletId: string; name: string; brand: string; district: string } | null;
}

export interface OutletDto {
  outletId: string;
  name: string;
  brand: Brand;
  district: string;
  depot: Depot;
  dockType: DockType;
  parkingConstraint: ParkingConstraint;
  windowOpen: string;
  windowClose: string;
  mallWindow: string | null;
}

export interface DecisionDto {
  decision: 'served' | 'deferred';
  reasonCode: ReasonCode | null;
  deferralClass: DeferralClass | null;
  explanation: string | null;
  storeReason: string | null;
  secondConsecutive: boolean;
  acknowledged: boolean;
  notified: boolean;
}

export interface OrderDto {
  id: string;
  ref: string;
  outlet: OutletDto;
  temp: TempRequirement;
  units: number;
  weightKg: number;
  volumeM3: number;
  runDate: string;
  status: OrderStatus;
  source: 'task2b_s1' | 'synthetic_seed' | 'store_manager';
  deferredYesterday: boolean;
  daysSinceLastServed: number;
  placedAfterCutoff: boolean;
  createdAt: string;
  tripKey: string | null;
  tripId: string | null;
  plannedArrival: string | null;
  /** Live estimate once the vehicle has left (adjusted model, labelled "estimated"). */
  eta: string | null;
  lateRisk: boolean;
  deliveredAt: string | null;
  deliveredUnits: number | null;
  lastUpdateAt: string | null;
  decision: DecisionDto | null;
  carriedTo: { ref: string; runDate: string } | null;
  receipt: { unitsReceived: number; damagedUnits: number; problem: boolean; note: string | null; at: string } | null;
}

export interface GaugeDto {
  used: number;
  cap: number;
}

export interface TripDto {
  id: string;
  key: string;
  planId: string;
  vehicleId: string;
  vehicleType: VehicleType;
  vehicleTemp: VehicleTemp;
  depot: Depot;
  tripNo: number;
  brand: Brand;
  district: string;
  status: TripStatus;
  depart: string;
  back: string;
  stopCount: number;
  stopsDone: number;
  weight: GaugeDto;
  volume: GaugeDto;
  /** This trip's minutes, and the vehicle's total for the same budget (both trips). */
  tripMin: number;
  budget: GaugeDto & { kind: 'fresh' | 'trading'; bothTrips: boolean };
  fuelL: number;
  weeklyQuotaL: number;
  tripsOnVehicle: number;
  driverName: string | null;
  loadedCount: number;
  lastSignalAt: string | null;
  reportedDelayMin: number;
  /** Departed and silent for 30+ minutes (no signal). */
  stale: boolean;
  lateRisk: boolean;
  hasIssue: boolean;
  hasShortfall: boolean;
  chilled: boolean;
  vanOnly: boolean;
}

export interface StopDto {
  id: string;
  seq: number;
  order: Pick<OrderDto, 'id' | 'ref' | 'temp' | 'units' | 'weightKg' | 'volumeM3' | 'status'>;
  outlet: OutletDto;
  status: StopStatus;
  plannedArrival: string;
  eta: string | null;
  late: boolean;
  serviceMin: number;
  loaded: boolean;
  completedAt: string | null;
  deliveredUnits: number | null;
  failureReason: FailureReason | null;
  recipientName: string | null;
  shortNote: string | null;
  hasPhoto: boolean;
  photoUrl: string | null;
  flags: { id: string; kind: 'shortfall' | 'damaged'; unitsAffected: number; note: string | null; at: string; photoUrl: string | null }[];
}

export interface TripDetailDto extends TripDto {
  runDate: string;
  stops: StopDto[];
  planVersion: number | null;
  seenVersion: number | null;
  changes: PlanChangeDto[];
  problems: { id: string; kind: ProblemKind; delayMin: number | null; note: string; at: string }[];
}

export interface PlanChangeDto {
  ref: string;
  outletId: string;
  outletName: string;
  change: 'added' | 'removed' | 'moved' | 'deferred';
  from?: string;
  to?: string;
  weightKg: number;
  volumeM3: number;
}

export interface PlanSummaryDto {
  served: number;
  deferred: number;
  unavoidable: number;
  choice: number;
  byBrand: Record<string, { served: number; deferred: number }>;
  byReason: Partial<Record<ReasonCode, number>>;
  limiting: { code: ReasonCode; label: string; deferrals: number } | null;
  trips: number;
  vehiclesUsed: number;
  vehiclesAvailable: number;
  engine: string;
  engineStatus: string;
  solveMs: number;
}

export interface DepotPlanDto {
  depot: Depot;
  planId: string | null;
  status: PlanStatus | null;
  version: number | null;
  publishedVersion: number | null;
  publishedAt: string | null;
  summary: PlanSummaryDto | null;
  trips: TripDto[];
  ordersInQueue: number;
}

export interface PlanBoardDto {
  runDate: string;
  depots: DepotPlanDto[];
}

export interface DeferralDto {
  order: OrderDto;
  planId: string;
  depot: Depot;
  vehiclesInWorkshop: string[];
}

export interface SkippedBeforeDto {
  outlet: OutletDto;
  skippedOn: string;
  reason: string | null;
  today: { ref: string; status: OrderStatus; tripKey: string | null } | null;
}

export interface ExceptionDto {
  id: string;
  code: string;
  type: ExceptionType;
  severity: Severity;
  title: string;
  body: string;
  vehicleId: string | null;
  tripId: string | null;
  tripKey: string | null;
  orderRef: string | null;
  orderId: string | null;
  outlet: OutletDto | null;
  raisedAt: string;
  raisedByRole: Role | null;
  resolvedAt: string | null;
  resolution: string | null;
  photoUrl: string | null;
}

export interface LiveDto {
  runDate: string;
  now: string;
  kpis: {
    ordersOnRun: number;
    delivered: number;
    scheduled: number;
    tripsToday: number;
    tripsCompleted: number;
    tripsOnRoad: number;
    deferred: number;
    deferredRefs: string[];
    openExceptions: number;
    openExceptionTitles: string[];
  };
  progress: { allocated: number; loading: number; inTransit: number; delivered: number; partial: number; issues: number; failed: number; stale: number };
  exceptions: ExceptionDto[];
  activeTrips: TripDto[];
}

export interface FleetVehicleDto {
  vehicleId: string;
  type: VehicleType;
  temp: VehicleTemp;
  depot: Depot;
  weightCapKg: number;
  volumeCapM3: number;
  weeklyQuotaL: number;
  fuelUsedL: number;
  status: VehicleDayStatus;
  note: string | null;
  trips: string[];
  driverName: string | null;
}

export interface NotificationDto {
  id: string;
  type: string;
  severity: Severity;
  title: string;
  body: string;
  link: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface MoveResultDto {
  ok: boolean;
  title?: string;
  message?: string;
  violations: { rule: string; message: string }[];
  preview: { tripKey: string; weightKg: number; volumeM3: number; weightCapKg: number; volumeCapM3: number; tripMin: number; stops: number };
}

export interface StoreHomeDto {
  outlet: OutletDto;
  clock: ClockDto;
  unitProfiles: { chilled: { kgPerUnit: number; m3PerUnit: number } | null; ambient: { kgPerUnit: number; m3PerUnit: number } | null };
  orders: OrderDto[];
  /** True when the delivery vehicle has not reported for a while. */
  updatesDelayed: { since: string } | null;
}

export interface LoaderTripsDto {
  depot: Depot;
  runDate: string | null;
  trips: TripDto[];
}

export interface DriverRunDto {
  vehicle: { vehicleId: string; type: VehicleType; temp: VehicleTemp; depot: Depot; weightCapKg: number; volumeCapM3: number; weeklyQuotaL: number };
  runDate: string | null;
  trips: TripDetailDto[];
}

export interface OutletHistoryDto {
  outlet: OutletDto;
  orders: OrderDto[];
  deferrals: number;
  issues: number;
}

export interface PolicyDto {
  runDate: string;
  depot: Depot;
  version: number | null;
  steps: readonly string[];
  summary: PlanSummaryDto | null;
  fleet: { available: number; inWorkshop: string[] };
  demand: { orders: number; chilled: number; weightKg: number; volumeM3: number; byBrand: Record<string, number> };
  deferred: { ref: string; outletName: string; reasonCode: ReasonCode; deferralClass: DeferralClass; explanation: string; consequence: string }[];
  calendar: ClockDto['calendar'];
}

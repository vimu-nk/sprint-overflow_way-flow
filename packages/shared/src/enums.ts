// Domain vocabulary. Values match the competition CSVs (outlets.csv, vehicles.csv) exactly.

export const BRANDS = ['Fresh', 'Style', 'Tech'] as const;
export type Brand = (typeof BRANDS)[number];

export const DEPOTS = ['Peliyagoda', 'Kandy'] as const;
export type Depot = (typeof DEPOTS)[number];

export const DOCK_TYPES = ['rear_dock', 'street', 'mall_bay'] as const;
export type DockType = (typeof DOCK_TYPES)[number];

export const PARKING_CONSTRAINTS = ['normal', 'van_only', 'mall_dock'] as const;
export type ParkingConstraint = (typeof PARKING_CONSTRAINTS)[number];

export const VEHICLE_TYPES = ['truck', 'van'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const VEHICLE_TEMPS = ['ambient', 'reefer'] as const;
export type VehicleTemp = (typeof VEHICLE_TEMPS)[number];

export const TEMP_REQUIREMENTS = ['ambient', 'chilled'] as const;
export type TempRequirement = (typeof TEMP_REQUIREMENTS)[number];

export const ROLES = ['dispatcher', 'loader', 'driver', 'store_manager'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_HOME: Record<Role, string> = {
  dispatcher: '/dispatcher',
  loader: '/loader',
  driver: '/driver',
  store_manager: '/store',
};

/** Order lifecycle (specs/20 F6). */
export const ORDER_STATUSES = [
  'draft',
  'confirmed',
  'planned',
  'published',
  'loaded',
  'departed',
  'delivered',
  'partial',
  'failed',
  'deferred',
  'received',
  'disputed',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PLAN_STATUSES = ['generated', 'edited', 'published', 'replanned', 'closed'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const TRIP_STATUSES = [
  'planned',
  'loading',
  'ready',
  'departed',
  'completed',
  'cancelled',
] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];

export const STOP_STATUSES = ['pending', 'arrived', 'delivered', 'partial', 'failed', 'skipped'] as const;
export type StopStatus = (typeof STOP_STATUSES)[number];

export const VEHICLE_DAY_STATUSES = ['available', 'in_workshop'] as const;
export type VehicleDayStatus = (typeof VEHICLE_DAY_STATUSES)[number];

/** Deferral reason codes (specs/03 §8). */
export const REASON_CODES = [
  'NO_REEFER_CAPACITY',
  'NO_VAN_CAPACITY',
  'TIME_BUDGET',
  'TRIP_LIMIT',
  'FUEL_QUOTA',
  'WINDOW_INFEASIBLE',
  'VEHICLE_UNAVAILABLE',
  'CAPACITY',
  'PRIORITY_TRADEOFF',
  'DISPATCHER_OVERRIDE',
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export const DEFERRAL_CLASSES = ['unavoidable', 'choice'] as const;
export type DeferralClass = (typeof DEFERRAL_CLASSES)[number];

export const FAILURE_REASONS = [
  'outlet_closed',
  'access_refused',
  'no_one_to_receive',
  'wrong_address',
  'goods_damaged',
  'ran_out_of_time',
  'other',
] as const;
export type FailureReason = (typeof FAILURE_REASONS)[number];

export const PROBLEM_KINDS = ['delay', 'breakdown', 'road_closure', 'access_refused', 'other'] as const;
export type ProblemKind = (typeof PROBLEM_KINDS)[number];

export const FLAG_KINDS = ['shortfall', 'damaged'] as const;
export type FlagKind = (typeof FLAG_KINDS)[number];

export const EXCEPTION_TYPES = [
  'shortfall',
  'damaged_load',
  'vehicle_offline',
  'receipt_issue',
  'failed_delivery',
  'road_problem',
  'plan_changed',
  'vehicle_workshop',
  'sync_conflict',
  'second_deferral',
] as const;
export type ExceptionType = (typeof EXCEPTION_TYPES)[number];

export const SEVERITIES = ['info', 'warning', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const ATTACHMENT_PURPOSES = ['pod', 'flag', 'receipt'] as const;
export type AttachmentPurpose = (typeof ATTACHMENT_PURPOSES)[number];

import type {
  FailureReason,
  OrderStatus,
  ProblemKind,
  ReasonCode,
  StopStatus,
  TripStatus,
} from './enums.js';

/** Status words used in the Designathon screens (design/). */
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  draft: 'Draft',
  confirmed: 'Ordered',
  planned: 'Allocated',
  published: 'Scheduled',
  loaded: 'Loaded',
  departed: 'On the way',
  delivered: 'Delivered',
  partial: 'Partly delivered',
  failed: 'Not delivered',
  deferred: 'Deferred',
  received: 'Received',
  disputed: 'Issue reported',
  cancelled: 'Cancelled',
};

export const TRIP_STATUS_LABEL: Record<TripStatus, string> = {
  planned: 'Scheduled',
  loading: 'Loading',
  ready: 'Loaded',
  departed: 'On the way',
  completed: 'Delivered',
  cancelled: 'Cancelled',
};

export const STOP_STATUS_LABEL: Record<StopStatus, string> = {
  pending: 'On the way',
  arrived: 'Arrived',
  delivered: 'Delivered',
  partial: 'Partly delivered',
  failed: 'Not delivered',
  skipped: 'Removed',
};

export type Tone = 'success' | 'info' | 'warning' | 'danger' | 'neutral';

export const ORDER_STATUS_TONE: Record<OrderStatus, Tone> = {
  draft: 'neutral',
  confirmed: 'neutral',
  planned: 'info',
  published: 'info',
  loaded: 'info',
  departed: 'info',
  delivered: 'success',
  partial: 'warning',
  failed: 'danger',
  deferred: 'warning',
  received: 'success',
  disputed: 'danger',
  cancelled: 'neutral',
};

export const TRIP_STATUS_TONE: Record<TripStatus, Tone> = {
  planned: 'info',
  loading: 'warning',
  ready: 'info',
  departed: 'info',
  completed: 'success',
  cancelled: 'neutral',
};

export const STOP_STATUS_TONE: Record<StopStatus, Tone> = {
  pending: 'info',
  arrived: 'info',
  delivered: 'success',
  partial: 'warning',
  failed: 'danger',
  skipped: 'neutral',
};

/** Store-facing reason text. `vanOnly` picks the van wording used in the design. */
export function reasonText(code: ReasonCode, opts: { chilled?: boolean; vanOnly?: boolean } = {}): string {
  switch (code) {
    case 'NO_REEFER_CAPACITY':
      return opts.vanOnly
        ? 'No refrigerated van capacity left (van-only outlet)'
        : 'No refrigerated truck capacity left';
    case 'NO_VAN_CAPACITY':
      return opts.chilled
        ? 'No refrigerated van capacity left (van-only outlet)'
        : 'No van capacity left (van-only outlet)';
    case 'TIME_BUDGET':
      return 'No vehicle has trip time left in its daily budget';
    case 'TRIP_LIMIT':
      return 'Every suitable vehicle already runs its 2 trips';
    case 'FUEL_QUOTA':
      return 'Suitable vehicles have used their weekly fuel quota';
    case 'WINDOW_INFEASIBLE':
      return 'The delivery cannot reach the outlet inside its window';
    case 'VEHICLE_UNAVAILABLE':
      return 'The suitable vehicles are in the workshop';
    case 'CAPACITY':
      return 'No truck capacity left (weight or volume)';
    case 'PRIORITY_TRADEOFF':
      return 'Capacity went to higher-priority orders';
    case 'DISPATCHER_OVERRIDE':
      return 'Deferred by the dispatcher';
  }
}

export const REASON_CODE_LABEL: Record<ReasonCode, string> = {
  NO_REEFER_CAPACITY: 'Refrigerated capacity',
  NO_VAN_CAPACITY: 'Van capacity',
  TIME_BUDGET: 'Time budget',
  TRIP_LIMIT: 'Trip limit',
  FUEL_QUOTA: 'Fuel quota',
  WINDOW_INFEASIBLE: 'Delivery window',
  VEHICLE_UNAVAILABLE: 'Vehicle in workshop',
  CAPACITY: 'Truck capacity',
  PRIORITY_TRADEOFF: 'Priority trade-off',
  DISPATCHER_OVERRIDE: 'Dispatcher decision',
};

export const FAILURE_REASON_LABEL: Record<FailureReason, string> = {
  outlet_closed: 'Outlet closed',
  access_refused: 'Access refused',
  no_one_to_receive: 'No one to receive',
  wrong_address: 'Could not find the outlet',
  goods_damaged: 'Goods damaged in transit',
  ran_out_of_time: 'Ran out of time',
  other: 'Other',
};

export const PROBLEM_KIND_LABEL: Record<ProblemKind, string> = {
  delay: 'Delay',
  breakdown: 'Breakdown',
  road_closure: 'Road closure',
  access_refused: 'Access refused',
  other: 'Other problem',
};

export function outletName(o: { brand: string; district: string; outletId: string }, index?: number): string {
  return index ? `Waypoint ${o.brand} ${o.district} ${index}` : `Waypoint ${o.brand} ${o.district}`;
}

export function formatKg(kg: number): string {
  return `${Math.round(kg).toLocaleString('en-US')} kg`;
}

export function formatM3(m3: number): string {
  return `${(Math.round(m3 * 10) / 10).toLocaleString('en-US')} m³`;
}

export function formatNumber(n: number, digits = 0): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  date,
  doublePrecision,
  index,
  inet,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  ATTACHMENT_PURPOSES,
  BRANDS,
  DEFERRAL_CLASSES,
  DEPOTS,
  DOCK_TYPES,
  EXCEPTION_TYPES,
  FAILURE_REASONS,
  FLAG_KINDS,
  ORDER_STATUSES,
  PARKING_CONSTRAINTS,
  PLAN_STATUSES,
  PROBLEM_KINDS,
  REASON_CODES,
  ROLES,
  SEVERITIES,
  STOP_STATUSES,
  TEMP_REQUIREMENTS,
  TRIP_STATUSES,
  VEHICLE_DAY_STATUSES,
  VEHICLE_TEMPS,
  VEHICLE_TYPES,
} from '@wayflow/shared';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts('created_at').notNull().defaultNow();

// ---------- Enums ----------
export const brandEnum = pgEnum('brand', BRANDS);
export const depotEnum = pgEnum('depot', DEPOTS);
export const dockTypeEnum = pgEnum('dock_type', DOCK_TYPES);
export const parkingEnum = pgEnum('parking_constraint', PARKING_CONSTRAINTS);
export const vehicleTypeEnum = pgEnum('vehicle_type', VEHICLE_TYPES);
export const vehicleTempEnum = pgEnum('vehicle_temp', VEHICLE_TEMPS);
export const tempEnum = pgEnum('temp_requirement', TEMP_REQUIREMENTS);
export const roleEnum = pgEnum('role', ROLES);
export const orderStatusEnum = pgEnum('order_status', ORDER_STATUSES);
export const planStatusEnum = pgEnum('plan_status', PLAN_STATUSES);
export const tripStatusEnum = pgEnum('trip_status', TRIP_STATUSES);
export const stopStatusEnum = pgEnum('stop_status', STOP_STATUSES);
export const vehicleDayStatusEnum = pgEnum('vehicle_day_status', VEHICLE_DAY_STATUSES);
export const reasonCodeEnum = pgEnum('reason_code', REASON_CODES);
export const deferralClassEnum = pgEnum('deferral_class', DEFERRAL_CLASSES);
export const failureReasonEnum = pgEnum('failure_reason', FAILURE_REASONS);
export const problemKindEnum = pgEnum('problem_kind', PROBLEM_KINDS);
export const flagKindEnum = pgEnum('flag_kind', FLAG_KINDS);
export const exceptionTypeEnum = pgEnum('exception_type', EXCEPTION_TYPES);
export const severityEnum = pgEnum('severity', SEVERITIES);
export const attachmentPurposeEnum = pgEnum('attachment_purpose', ATTACHMENT_PURPOSES);
export const orderSourceEnum = pgEnum('order_source', ['task2b_s1', 'synthetic_seed', 'store_manager']);
export const decisionEnum = pgEnum('decision', ['served', 'deferred']);

// ---------- Reference data (1:1 with data/source/General Data/*.csv) ----------
export const outlets = pgTable('outlets', {
  outletId: text('outlet_id').primaryKey(),
  brand: brandEnum('brand').notNull(),
  district: text('district').notNull(),
  depot: depotEnum('depot').notNull(),
  dockType: dockTypeEnum('dock_type').notNull(),
  parkingConstraint: parkingEnum('parking_constraint').notNull(),
  /** Minutes since midnight, Asia/Colombo. Null when the outlet has no mall window. */
  mallOpenMin: smallint('mall_open_min'),
  mallCloseMin: smallint('mall_close_min'),
  windowOpenMin: smallint('window_open_min').notNull(),
  windowCloseMin: smallint('window_close_min').notNull(),
  /** Display name derived from brand, district and position: "Waypoint Fresh Nuwara Eliya 2". */
  name: text('name').notNull(),
});

export const vehicles = pgTable(
  'vehicles',
  {
    vehicleId: text('vehicle_id').primaryKey(),
    type: vehicleTypeEnum('type').notNull(),
    temp: vehicleTempEnum('temp').notNull(),
    weightCapKg: real('weight_cap_kg').notNull(),
    volumeCapM3: real('volume_cap_m3').notNull(),
    fuelType: text('fuel_type').notNull(),
    kmPerL: real('km_per_l').notNull(),
    weeklyFuelQuotaL: real('weekly_fuel_quota_l').notNull(),
    depot: depotEnum('depot').notNull(),
  },
  (t) => [check('vehicle_caps_positive', sql`${t.weightCapKg} > 0 and ${t.volumeCapM3} > 0 and ${t.kmPerL} > 0`)],
);

export const calendarDays = pgTable('calendar_days', {
  date: date('date').primaryKey(),
  dow: smallint('dow').notNull(),
  dowName: text('dow_name').notNull(),
  isWeekend: boolean('is_weekend').notNull(),
  isoYear: smallint('iso_year').notNull(),
  isoWeek: smallint('iso_week').notNull(),
  isPayday: boolean('is_payday').notNull(),
  festival: text('festival'),
  festivalRamp: real('festival_ramp').notNull(),
  isHoliday: boolean('is_holiday').notNull(),
  monsoon: boolean('monsoon').notNull(),
  isOperating: boolean('is_operating').notNull(),
});

export const districtTravel = pgTable('district_travel', {
  district: text('district').primaryKey(),
  depot: depotEnum('depot').notNull(),
  roadClass: text('road_class').notNull(),
  freeFlowKmh: real('free_flow_kmh').notNull(),
  depotToDistrictKm: real('depot_to_district_km').notNull(),
  depotToDistrictFreeflowMin: real('depot_to_district_freeflow_min').notNull(),
  interStopKm: real('inter_stop_km').notNull(),
  interStopFreeflowMin: real('inter_stop_freeflow_min').notNull(),
});

export const serviceAllowances = pgTable(
  'service_allowances',
  {
    brand: brandEnum('brand').notNull(),
    dockType: dockTypeEnum('dock_type').notNull(),
    minutes: real('service_allowance_min').notNull(),
  },
  (t) => [primaryKey({ columns: [t.brand, t.dockType] })],
);

export const trafficSpeeds = pgTable(
  'traffic_speeds',
  {
    district: text('district').notNull(),
    hour: smallint('hour').notNull(),
    monsoon: boolean('monsoon').notNull(),
    speedIndex: real('speed_index').notNull(),
  },
  (t) => [primaryKey({ columns: [t.district, t.hour, t.monsoon] })],
);

export const roadConditions = pgTable(
  'road_conditions',
  {
    district: text('district').notNull(),
    date: date('date').notNull(),
    disruptionIndex: real('disruption_index').notNull(),
  },
  (t) => [primaryKey({ columns: [t.district, t.date] })],
);

/** Average kg and m³ per unit by brand and temperature, from deliveries_train.csv history. */
export const unitProfiles = pgTable(
  'unit_profiles',
  {
    brand: brandEnum('brand').notNull(),
    temp: tempEnum('temp').notNull(),
    kgPerUnit: real('kg_per_unit').notNull(),
    m3PerUnit: real('m3_per_unit').notNull(),
    sampleSize: integer('sample_size').notNull(),
  },
  (t) => [primaryKey({ columns: [t.brand, t.temp] })],
);

// ---------- People, sessions, audit ----------
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    role: roleEnum('role').notNull(),
    passwordHash: text('password_hash').notNull(),
    depot: depotEnum('depot'),
    outletId: text('outlet_id').references(() => outlets.outletId),
    vehicleId: text('vehicle_id').references(() => vehicles.vehicleId),
    isActive: boolean('is_active').notNull().default(true),
    sessionsValidAfter: ts('sessions_valid_after').notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('users_email_uq').on(t.email),
    check(
      'users_scope',
      sql`(${t.role} <> 'store_manager' or ${t.outletId} is not null) and (${t.role} <> 'loader' or ${t.depot} is not null) and (${t.role} <> 'driver' or ${t.vehicleId} is not null)`,
    ),
  ],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
    lastUsedAt: ts('last_used_at'),
    usedAt: ts('used_at'),
    idleExpiresAt: ts('idle_expires_at').notNull(),
    absoluteExpiresAt: ts('absolute_expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    replacedBy: uuid('replaced_by'),
  },
  (t) => [uniqueIndex('refresh_tokens_hash_uq').on(t.tokenHash), index('refresh_tokens_family_idx').on(t.familyId)],
);

/** Append-only: the app role gets INSERT/SELECT only (SEC-60, SEC-67). */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    at: ts('at').notNull().defaultNow(),
    actorUserId: uuid('actor_user_id'),
    actorRole: text('actor_role'),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    details: jsonb('details').$type<Record<string, unknown>>(),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    requestId: text('request_id'),
  },
  (t) => [index('audit_entity_idx').on(t.entityType, t.entityId), index('audit_at_idx').on(t.at)],
);

// ---------- Orders ----------
export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Order reference shown everywhere (ORD…). For task2b orders this is the scenario order_ref. */
    ref: text('ref').notNull(),
    outletId: text('outlet_id')
      .notNull()
      .references(() => outlets.outletId),
    brand: brandEnum('brand').notNull(),
    temp: tempEnum('temp').notNull(),
    units: integer('units').notNull(),
    weightKg: real('weight_kg').notNull(),
    volumeM3: real('volume_m3').notNull(),
    runDate: date('run_date').notNull(),
    status: orderStatusEnum('status').notNull(),
    source: orderSourceEnum('source').notNull(),
    placedBy: uuid('placed_by').references(() => users.id),
    deferredYesterday: boolean('deferred_yesterday').notNull().default(false),
    daysSinceLastServed: smallint('days_since_last_served').notNull().default(1),
    /** Set when a deferred order is carried to the next run (F6 deferred → confirmed). */
    carriedFromId: uuid('carried_from_id'),
    deliveredUnits: integer('delivered_units'),
    placedAfterCutoff: boolean('placed_after_cutoff').notNull().default(false),
    confirmedAt: ts('confirmed_at'),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('orders_ref_uq').on(t.ref),
    index('orders_run_status_idx').on(t.runDate, t.status),
    index('orders_outlet_idx').on(t.outletId, t.runDate),
    check('orders_positive', sql`${t.units} > 0 and ${t.weightKg} > 0 and ${t.volumeM3} > 0`),
  ],
);

// ---------- Planning ----------
export const plans = pgTable(
  'plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runDate: date('run_date').notNull(),
    depot: depotEnum('depot').notNull(),
    status: planStatusEnum('status').notNull(),
    /** Working version; increments on every publish after the first. */
    version: integer('version').notNull().default(1),
    publishedVersion: integer('published_version'),
    summary: jsonb('summary').$type<Record<string, unknown>>(),
    engine: text('engine').notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    publishedAt: ts('published_at'),
  },
  (t) => [uniqueIndex('plans_run_depot_uq').on(t.runDate, t.depot)],
);

/** Snapshot of every published version so loaders and drivers see a diff. */
export const planVersions = pgTable(
  'plan_versions',
  {
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    snapshot: jsonb('snapshot').$type<Record<string, string[]>>().notNull(),
    diff: jsonb('diff').$type<unknown[]>(),
    publishedBy: uuid('published_by').references(() => users.id),
    publishedAt: ts('published_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.planId, t.version] })],
);

export const vehicleDays = pgTable(
  'vehicle_days',
  {
    vehicleId: text('vehicle_id')
      .notNull()
      .references(() => vehicles.vehicleId),
    date: date('date').notNull(),
    status: vehicleDayStatusEnum('status').notNull(),
    note: text('note'),
    updatedBy: uuid('updated_by').references(() => users.id),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.vehicleId, t.date] })],
);

export const trips = pgTable(
  'trips',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    runDate: date('run_date').notNull(),
    vehicleId: text('vehicle_id')
      .notNull()
      .references(() => vehicles.vehicleId),
    tripNo: smallint('trip_no').notNull(),
    brand: brandEnum('brand').notNull(),
    district: text('district')
      .notNull()
      .references(() => districtTravel.district),
    status: tripStatusEnum('status').notNull().default('planned'),
    departMin: smallint('depart_min').notNull(),
    returnMin: smallint('return_min').notNull(),
    /** Snapshot of weight, volume, trip-minute breakdown and fuel at last (re)plan. */
    metrics: jsonb('metrics').$type<Record<string, number>>().notNull(),
    loadingStartedAt: ts('loading_started_at'),
    readyAt: ts('ready_at'),
    departedAt: ts('departed_at'),
    completedAt: ts('completed_at'),
    lastSignalAt: ts('last_signal_at'),
    reportedDelayMin: smallint('reported_delay_min').notNull().default(0),
    /** Plan version the loader or driver last acknowledged (plan-changed banner). */
    seenVersion: integer('seen_version'),
    createdAt: createdAt(),
  },
  (t) => [
    // ≤ 2 trips per vehicle per day: trip_no ∈ {1,2} and unique among live trips.
    check('trips_trip_no', sql`${t.tripNo} in (1, 2)`),
    uniqueIndex('trips_vehicle_day_uq').on(t.runDate, t.vehicleId, t.tripNo).where(sql`${t.status} <> 'cancelled'`),
    index('trips_plan_idx').on(t.planId),
    index('trips_date_vehicle_idx').on(t.runDate, t.vehicleId),
  ],
);

/** One stop per order on a trip, in sequence. Orders for the same outlet sit next to each other. */
export const stops = pgTable(
  'stops',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    seq: smallint('seq').notNull(),
    plannedArrivalMin: smallint('planned_arrival_min').notNull(),
    serviceMin: real('service_min').notNull(),
    late: boolean('late').notNull().default(false),
    status: stopStatusEnum('status').notNull().default('pending'),
    loaded: boolean('loaded').notNull().default(false),
    loadedAt: ts('loaded_at'),
    arrivedAt: ts('arrived_at'),
    completedAt: ts('completed_at'),
    /** Client clock time of the field event (proof-of-delivery semantics, specs/08 §3). */
    completedAtClient: ts('completed_at_client'),
    deliveredUnits: integer('delivered_units'),
    failureReason: failureReasonEnum('failure_reason'),
    shortNote: text('short_note'),
    recipientName: text('recipient_name'),
    geoLat: doublePrecision('geo_lat'),
    geoLng: doublePrecision('geo_lng'),
    needsReview: boolean('needs_review').notNull().default(false),
  },
  (t) => [
    index('stops_trip_seq_idx').on(t.tripId, t.seq),
    uniqueIndex('stops_order_live_uq').on(t.orderId).where(sql`${t.status} <> 'skipped'`),
  ],
);

/** Engine or dispatcher decision for every order in a plan. */
export const decisions = pgTable(
  'decisions',
  {
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    decision: decisionEnum('decision').notNull(),
    reasonCode: reasonCodeEnum('reason_code'),
    deferralClass: deferralClassEnum('deferral_class'),
    explanation: text('explanation'),
    /** Text the store manager sees (editable by the dispatcher before publish). */
    storeReason: text('store_reason'),
    priority: integer('priority').notNull().default(0),
    secondConsecutive: boolean('second_consecutive').notNull().default(false),
    acknowledged: boolean('acknowledged').notNull().default(false),
    notifiedAt: ts('notified_at'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.planId, t.orderId] }),
    check('decisions_deferred_reason', sql`${t.decision} = 'served' or ${t.reasonCode} is not null`),
  ],
);

// ---------- Field events ----------
export const loadFlags = pgTable('load_flags', {
  /** Equals the client action id, so the device can attach a photo while offline. */
  id: uuid('id').primaryKey(),
  tripId: uuid('trip_id')
    .notNull()
    .references(() => trips.id),
  stopId: uuid('stop_id')
    .notNull()
    .references(() => stops.id),
  kind: flagKindEnum('kind').notNull(),
  unitsAffected: integer('units_affected').notNull(),
  note: text('note'),
  afterDeparture: boolean('after_departure').notNull().default(false),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAtClient: ts('created_at_client'),
  createdAt: createdAt(),
});

export const problemReports = pgTable('problem_reports', {
  id: uuid('id').primaryKey(),
  tripId: uuid('trip_id')
    .notNull()
    .references(() => trips.id),
  kind: problemKindEnum('kind').notNull(),
  delayMin: smallint('delay_min'),
  note: text('note').notNull(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAtClient: ts('created_at_client'),
  createdAt: createdAt(),
});

export const receipts = pgTable('receipts', {
  orderId: uuid('order_id')
    .primaryKey()
    .references(() => orders.id),
  unitsReceived: integer('units_received').notNull(),
  damagedUnits: integer('damaged_units').notNull().default(0),
  problem: boolean('problem').notNull(),
  note: text('note'),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: createdAt(),
});

/** Single exception queue for the dispatcher (shortfalls, offline vehicles, receipt issues, …). */
export const exceptions = pgTable(
  'exceptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    type: exceptionTypeEnum('type').notNull(),
    severity: severityEnum('severity').notNull(),
    runDate: date('run_date').notNull(),
    vehicleId: text('vehicle_id').references(() => vehicles.vehicleId),
    tripId: uuid('trip_id').references(() => trips.id),
    orderId: uuid('order_id').references(() => orders.id),
    outletId: text('outlet_id').references(() => outlets.outletId),
    title: text('title').notNull(),
    body: text('body').notNull(),
    raisedBy: uuid('raised_by').references(() => users.id),
    raisedAt: ts('raised_at').notNull().defaultNow(),
    resolvedAt: ts('resolved_at'),
    resolvedBy: uuid('resolved_by').references(() => users.id),
    resolution: text('resolution'),
  },
  (t) => [uniqueIndex('exceptions_code_uq').on(t.code), index('exceptions_run_idx').on(t.runDate)],
);

export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    objectKey: text('object_key').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    purpose: attachmentPurposeEnum('purpose').notNull(),
    /** stop | flag | receipt */
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id),
    clientAttachmentId: uuid('client_attachment_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('attachments_client_uq').on(t.uploadedBy, t.clientAttachmentId),
    index('attachments_entity_idx').on(t.entityType, t.entityId),
  ],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    severity: severityEnum('severity').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    link: text('link'),
    createdAt: createdAt(),
    readAt: ts('read_at'),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.createdAt), index('notifications_unread_idx').on(t.userId).where(sql`${t.readAt} is null`)],
);

/** Idempotency ledger for offline actions; unique per user (SEC-75). */
export const syncActions = pgTable(
  'sync_actions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    clientActionId: uuid('client_action_id').notNull(),
    deviceId: text('device_id').notNull(),
    type: text('type').notNull(),
    status: text('status').notNull(),
    result: jsonb('result').$type<Record<string, unknown>>(),
    createdAtClient: ts('created_at_client').notNull(),
    clockSkewFlag: boolean('clock_skew_flag').notNull().default(false),
    receivedAt: ts('received_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('sync_actions_user_client_uq').on(t.userId, t.clientActionId)],
);

/** Key/value settings: the simulation clock lives here. */
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

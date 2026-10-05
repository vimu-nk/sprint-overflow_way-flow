import { z } from 'zod';
import {
  DEPOTS,
  FAILURE_REASONS,
  FLAG_KINDS,
  PROBLEM_KINDS,
  REASON_CODES,
  VEHICLE_DAY_STATUSES,
} from './enums.js';

// Request schemas. Every one is `.strict()` so unknown fields are rejected (SEC-27, SEC-34).

/** Free text: trimmed, NFC-normalised, no control characters (SEC-44). */
export const safeText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((s) => s.normalize('NFC').trim())
    // eslint-disable-next-line no-control-regex -- rejecting control characters is the point (SEC-44)
    .refine((s) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(s), 'Contains control characters');

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const uuid = z.string().uuid();
const units = z.number().int().min(0).max(5000);

export const loginSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(1).max(128),
  })
  .strict();

export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(12).max(128) })
  .strict();

export const placeOrderSchema = z
  .object({
    chilledUnits: units.default(0),
    ambientUnits: units.default(0),
    clientActionId: uuid.optional(),
  })
  .strict()
  .refine((v) => v.chilledUnits + v.ambientUnits > 0, 'Enter at least one unit');

export const receiptSchema = z
  .object({
    unitsReceived: units,
    damagedUnits: units.default(0),
    problem: z.boolean().default(false),
    note: safeText(280).optional(),
    attachmentId: uuid.optional(),
  })
  .strict();

export const runPlanSchema = z.object({ date: isoDate, depot: z.enum(DEPOTS) }).strict();

export const moveOrderSchema = z
  .object({
    orderId: uuid,
    /** Target vehicle; null defers the order instead. */
    vehicleId: z.string().regex(/^VEH\d{3}$/),
    tripNo: z.number().int().min(1).max(2),
    reason: safeText(280).pipe(z.string().min(3, 'Give a reason for the change')),
    dryRun: z.boolean().default(false),
  })
  .strict();

export const deferOrderSchema = z
  .object({
    orderId: uuid,
    reasonCode: z.enum(REASON_CODES),
    reason: safeText(280).pipe(z.string().min(3, 'Every deferral needs a reason')),
    acknowledgeSecondDeferral: z.boolean().default(false),
  })
  .strict();

export const deferralReasonSchema = z
  .object({ reason: safeText(280).pipe(z.string().min(3, 'Every deferral needs a reason')) })
  .strict();

export const publishSchema = z.object({ acknowledgeSecondDeferrals: z.boolean().default(false) }).strict();

export const vehicleStatusSchema = z
  .object({
    date: isoDate,
    status: z.enum(VEHICLE_DAY_STATUSES),
    note: safeText(200).optional(),
  })
  .strict();

export const resolveExceptionSchema = z.object({ resolution: safeText(400).pipe(z.string().min(3)) }).strict();

export const clockSchema = z
  .object({ date: isoDate, time: z.string().regex(/^\d{2}:\d{2}$/) })
  .strict();

export const listQuerySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(100).default(50), cursor: z.string().max(64).optional() })
  .strict();

// ----- Offline-capable field actions (driver + loader), sent through POST /sync/batch -----

const loadCheck = z
  .object({ type: z.literal('load.check'), tripId: uuid, stopId: uuid, loaded: z.boolean() })
  .strict();
const loadFlag = z
  .object({
    type: z.literal('load.flag'),
    tripId: uuid,
    stopId: uuid,
    kind: z.enum(FLAG_KINDS),
    unitsAffected: z.number().int().min(1).max(5000),
    note: safeText(280).optional(),
    hasPhoto: z.boolean().default(false),
  })
  .strict();
const loadReady = z.object({ type: z.literal('load.ready'), tripId: uuid }).strict();
const tripStart = z.object({ type: z.literal('trip.start'), tripId: uuid }).strict();
const stopArrive = z.object({ type: z.literal('stop.arrive'), stopId: uuid }).strict();
const stopOutcome = z
  .object({
    type: z.literal('stop.outcome'),
    stopId: uuid,
    outcome: z.enum(['delivered', 'partial', 'failed']),
    deliveredUnits: z.number().int().min(0).max(5000).optional(),
    shortNote: safeText(200).optional(),
    failureReason: z.enum(FAILURE_REASONS).optional(),
    recipientName: safeText(80).optional(),
    hasPhoto: z.boolean().default(false),
    geo: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).strict().optional(),
  })
  .strict();
const problemReport = z
  .object({
    type: z.literal('problem.report'),
    tripId: uuid,
    kind: z.enum(PROBLEM_KINDS),
    delayMin: z.number().int().min(0).max(600).optional(),
    note: safeText(280),
  })
  .strict();

export const fieldActionSchema = z.discriminatedUnion('type', [
  loadCheck,
  loadFlag,
  loadReady,
  tripStart,
  stopArrive,
  stopOutcome,
  problemReport,
]);
export type FieldAction = z.infer<typeof fieldActionSchema>;
export type FieldActionType = FieldAction['type'];

export const syncBatchSchema = z
  .object({
    deviceId: z.string().min(8).max(64).regex(/^[A-Za-z0-9-]+$/),
    actions: z
      .array(
        z
          .object({
            clientActionId: uuid,
            createdAtClient: z.string().datetime({ offset: true }),
            action: fieldActionSchema,
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export type SyncBatch = z.infer<typeof syncBatchSchema>;

export type SyncResultStatus = 'applied' | 'duplicate' | 'conflict' | 'rejected';
export interface SyncResult {
  clientActionId: string;
  status: SyncResultStatus;
  reason?: string;
  message?: string;
}

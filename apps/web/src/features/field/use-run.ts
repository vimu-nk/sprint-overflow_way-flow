import type { DriverRunDto, MeDto } from '@wayflow/shared';
import { applyOverlay, overlay, useFieldData, useOutbox } from '@/lib/offline/field-data';

/** The driver's run with queued (unsynced) actions applied optimistically. */
export function useRun(me: MeDto) {
  const q = useFieldData<DriverRunDto>(me, ['run'], '/driver/run');
  const outbox = useOutbox(me.id);
  const ov = overlay(outbox);
  const trips = (q.data?.data.trips ?? []).map((t) => applyOverlay(t, ov));
  // Current trip: the first one not completed (trip 2 after trip 1).
  const current = trips.find((t) => t.status !== 'completed') ?? trips[trips.length - 1];
  return { q, run: q.data?.data, trips, current, ov, outbox };
}

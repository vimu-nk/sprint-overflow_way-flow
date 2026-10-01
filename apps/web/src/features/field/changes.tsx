import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TripDetailDto } from '@wayflow/shared';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { post } from '@/lib/api';
import { fmt1 } from '@/lib/format';

/** "Plan changed" banner with the diff for this trip (L-03, F9). Acknowledging records the version seen. */
export function PlanChanged({ t, role, doNotLoad }: { t: TripDetailDto; role: 'loader' | 'driver'; doNotLoad?: boolean }) {
  const qc = useQueryClient();
  const seen = useMutation({
    mutationFn: () => post(`/${role}/trips/${t.id}/seen`),
    onSuccess: () => ['run', 'loader-trip', 'loads'].forEach((k) => void qc.invalidateQueries({ queryKey: [k] })),
  });
  if (!t.changes.length || (t.seenVersion ?? 0) >= (t.planVersion ?? 0)) return null;
  const lines = t.changes.map((c) =>
    c.change === 'moved' && c.from === t.key
      ? `${c.outletId}${doNotLoad ? ` (${c.ref})` : ''} moved to ${c.to}.${doNotLoad ? ' Do not load it.' : ''}`
      : c.change === 'moved' || c.change === 'added'
        ? `${c.outletId} (${c.ref}) added to this trip: ${fmt1(c.volumeM3)} m³.`
        : `${c.outletId} (${c.ref}) taken off this trip.`,
  );
  return (
    <Banner tone="warning" title={`Plan changed (version ${t.planVersion})`} className="mb-4" action={<Button size="sm" variant="secondary" onClick={() => seen.mutate()} loading={seen.isPending}>Got it</Button>}>
      {lines.join(' ')}
    </Banner>
  );
}

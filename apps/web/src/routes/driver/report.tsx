import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { PROBLEM_KIND_LABEL, type ProblemKind } from '@wayflow/shared';
import { Minus, Plus } from 'lucide-react';
import { useState } from 'react';
import { FieldShell } from '@/components/shell/field-shell';
import { Breadcrumbs } from '@/components/shell/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Textarea } from '@/components/ui/form';
import { EmptyState } from '@/components/ui/states';
import { useRun } from '@/features/field/use-run';
import { cn } from '@/lib/cn';
import { notify } from '@/lib/notify';
import { enqueue } from '@/lib/offline/sync';

export const Route = createFileRoute('/driver/report')({ component: Report });

const KINDS: ProblemKind[] = ['delay', 'breakdown', 'road_closure', 'access_refused', 'other'];

/** R-06 Report a problem: dispatcher and affected stores are told; delay feeds the arrival estimates. */
function Report() {
  const { me } = Route.useRouteContext();
  const navigate = useNavigate();
  const { current: t } = useRun(me);
  const [kind, setKind] = useState<ProblemKind>('delay');
  const [delay, setDelay] = useState(30);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!t) return;
    if (note.trim().length < 3) return setError('Say briefly what happened.');
    await enqueue({ type: 'problem.report', tripId: t.id, kind, delayMin: kind === 'delay' || kind === 'road_closure' ? delay : undefined, note: note.trim() });
    notify.success('Problem reported', navigator.onLine ? 'The dispatcher has been told.' : 'Saved on this device. It sends when signal returns.');
    void navigate({ to: '/driver' });
  };
  return (
    <FieldShell me={me} syncTo="/driver/sync" bottom={t ? <Button size="xl" block onClick={() => void save()}>Send report</Button> : undefined}>
      <Breadcrumbs items={[{ label: 'My run', to: '/driver' }, { label: 'Report a problem' }]} />
      <h1 className="m-0 mb-4 text-[28px] leading-9 font-bold text-brand-ink">Report a Problem</h1>
      {!t ? (
        <EmptyState title="No trip to report on" />
      ) : (
        <Card className="flex flex-col gap-4 p-4">
          <p className="m-0 text-[16px] text-muted">{t.key}. Use this only when you are safely stopped.</p>
          <div role="radiogroup" aria-label="Problem" className="grid grid-cols-2 gap-2">
            {KINDS.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)} className={cn('min-h-12 rounded-control border px-3 text-[15px] font-medium', kind === k ? 'border-brand bg-brand-tint text-brand' : 'border-line bg-white')}>
                {PROBLEM_KIND_LABEL[k]}
              </button>
            ))}
          </div>
          {(kind === 'delay' || kind === 'road_closure') && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-[16px]">Expected delay</span>
              <div className="flex items-center gap-2">
                <Button variant="secondary" aria-label="Less" onClick={() => setDelay((d) => Math.max(5, d - 5))}>
                  <Minus className="size-5" aria-hidden />
                </Button>
                <span className="w-20 text-center text-[17px] font-semibold" aria-live="polite">
                  {delay} min
                </span>
                <Button variant="secondary" aria-label="More" onClick={() => setDelay((d) => Math.min(600, d + 5))}>
                  <Plus className="size-5" aria-hidden />
                </Button>
              </div>
            </div>
          )}
          <Field label="What happened" htmlFor="pr-note" error={error}>
            <Textarea id="pr-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Flooding on the hill road" maxLength={280} />
          </Field>
        </Card>
      )}
    </FieldShell>
  );
}

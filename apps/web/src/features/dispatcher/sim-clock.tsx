import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock3 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/form';
import { post } from '@/lib/api';
import { dayMonth } from '@/lib/format';
import { notify } from '@/lib/notify';
import { useClock } from '@/lib/queries';

const PRESETS = [
  { label: 'Tue 19 May, 14:00 — orders open', date: '2026-05-19', time: '14:00' },
  { label: 'Tue 19 May, 16:30 — after the cutoff', date: '2026-05-19', time: '16:30' },
  { label: 'Wed 20 May, 03:15 — loading at the dock', date: '2026-05-20', time: '03:15' },
  { label: 'Wed 20 May, 05:30 — vehicles on the road', date: '2026-05-20', time: '05:30' },
];

/**
 * Simulation clock (X-08): the calendar data ends 28 Jun 2026, so the demo runs on a simulated
 * Asia/Colombo clock. Dispatcher-only and only when demo tools are enabled (SEC-30).
 */
export function SimClock() {
  const clock = useClock();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState('2026-05-19');
  const [time, setTime] = useState('14:00');
  const [password, setPassword] = useState('');
  const set = useMutation({
    mutationFn: (v: { date: string; time: string }) => post('/dev/clock', v),
    meta: { topLoader: true },
    onSuccess: () => {
      void qc.invalidateQueries();
      notify.success('Simulation clock updated');
      setOpen(false);
    },
    onError: (e) => notify.fail(e, 'Could not change the clock'),
  });
  const reset = useMutation({
    mutationFn: () => post('/dev/reset', { password }),
    meta: { topLoader: true },
    onSuccess: () => {
      void qc.invalidateQueries();
      notify.success('Demo reset', 'Orders, plans and field records are back to the seeded state.');
      setOpen(false);
      setPassword('');
    },
    onError: (e) => notify.fail(e, 'Could not reset the demo'),
  });
  const c = clock.data;
  if (!c) return null;
  return (
    <div className="rounded-card border border-line bg-canvas p-3 text-[13px]">
      <p className="m-0 flex items-center gap-1.5 font-semibold text-ink">
        <Clock3 className="size-4 text-brand" aria-hidden /> Simulated time
      </p>
      <p className="m-0 mt-1 text-muted">
        {dayMonth(c.date)}, {c.time}. Orders go to the {dayMonth(c.orderRunDate)} run.
      </p>
      {c.outsideCalendar && <p className="m-0 mt-1 text-warn">Outside the calendar data: Sunday-closed fallback.</p>}
      {c.demoTools && (
        <Button size="sm" variant="secondary" className="mt-2 w-full" onClick={() => setOpen(true)}>
          Change
        </Button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title="Simulation clock">
        <div className="flex flex-col gap-2">
          {PRESETS.map((p) => (
            <Button key={p.label} variant="secondary" className="justify-start" loading={set.isPending && set.variables?.time === p.time && set.variables?.date === p.date} onClick={() => set.mutate(p)}>
              {p.label}
            </Button>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Field label="Date" htmlFor="sim-date">
            <Input id="sim-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Time" htmlFor="sim-time">
            <Input id="sim-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>
        <Button className="mt-3" block onClick={() => set.mutate({ date, time })} loading={set.isPending}>
          Set clock
        </Button>
        <div className="mt-6 border-t border-line pt-4">
          <p className="m-0 font-semibold">Reset the demo</p>
          <p className="m-0 mb-2 text-[13px] text-muted">Restores the seeded orders and removes plans and field records. Enter your password to confirm.</p>
          <Field label="Your password" htmlFor="reset-pw">
            <Input id="reset-pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Button className="mt-3" block variant="danger" disabled={!password} loading={reset.isPending} onClick={() => reset.mutate()}>
            Reset demo data
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

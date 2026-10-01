import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import type { PolicyDto } from '@wayflow/shared';
import { REASON_CODE_LABEL } from '@wayflow/shared';
import { Printer } from 'lucide-react';
import { PageHeader } from '@/components/shell/app-shell';
import { Breadcrumbs } from '@/components/shell/breadcrumbs';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SkeletonRows } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { get } from '@/lib/api';
import { fmtInt, fmt1, longDate } from '@/lib/format';

export const Route = createFileRoute('/dispatcher/policy/$planId')({ component: Policy });

/** D-11: one-page prioritisation write-up generated from the actual plan, printable. */
function Policy() {
  const { planId } = Route.useParams();
  const q = useQuery({ queryKey: ['plans', 'policy', planId], queryFn: () => get<PolicyDto>(`/dispatcher/plans/${planId}/policy`) });
  const p = q.data;
  return (
    <>
      <div className="print:hidden">
        <Breadcrumbs items={[{ label: 'Dispatcher', to: '/dispatcher' }, { label: 'Plan board', to: '/dispatcher/plan' }, { label: 'Policy write-up' }]} />
      </div>
      <PageHeader
        title="Prioritisation policy"
        subtitle={p ? `${p.depot} depot, ${longDate(p.runDate)} run${p.version ? `, plan version ${p.version}` : ', not yet published'}.` : undefined}
        action={
          <Button variant="secondary" onClick={() => window.print()} className="print:hidden">
            <Printer className="size-4" aria-hidden /> Print
          </Button>
        }
      />
      {q.isPending ? (
        <Card className="p-5">
          <SkeletonRows />
        </Card>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : p ? (
        <Card className="flex max-w-4xl flex-col gap-5 p-6 text-[15px] leading-6">
          <section>
            <h2 className="mt-0 mb-2 text-[18px] font-semibold text-brand-ink">1. The day in numbers</h2>
            <p className="m-0">
              {p.demand.orders} orders ({p.demand.chilled} chilled; {Object.entries(p.demand.byBrand).map(([b, n]) => `${b} ${n}`).join(', ')}) totalling {fmtInt(p.demand.weightKg)} kg and {fmt1(p.demand.volumeM3)} m³. {p.fleet.available} vehicles available
              {p.fleet.inWorkshop.length ? `; ${p.fleet.inWorkshop.length} in the workshop (${p.fleet.inWorkshop.join(', ')})` : ''}.
              {p.calendar ? ` Calendar: ${[p.calendar.monsoon && 'monsoon', p.calendar.isPayday && 'payday', p.calendar.festival && `festival ${p.calendar.festival}`, p.calendar.festivalRamp > 0 && `festival ramp ${p.calendar.festivalRamp}`].filter(Boolean).join(', ') || 'a normal operating day'}.` : ' Outside the calendar data.'}
            </p>
            {p.summary && (
              <p className="mt-2 mb-0">
                The plan serves <strong>{p.summary.served}</strong> orders on {p.summary.trips} trips ({p.summary.vehiclesUsed} vehicles) and defers <strong>{p.summary.deferred}</strong>: {p.summary.unavoidable} unavoidable and {p.summary.choice} by choice. The limiting resource is <strong>{p.summary.limiting?.label.toLowerCase() ?? 'none'}</strong>.
              </p>
            )}
          </section>
          <section>
            <h2 className="mt-0 mb-2 text-[18px] font-semibold text-brand-ink">2. Rules every trip satisfies</h2>
            <p className="m-0">
              One brand and one district per trip; chilled goods only on refrigerated vehicles; van-only outlets only by van; each vehicle serves its home depot; orders are never split; weight and volume both fit; at most two trips per vehicle; Fresh trips within 270 minutes and Style + Tech within 480 minutes per vehicle (trip time = outbound + inter-stop × (stops − 1) + handling, no return leg); fuel for the trip fits the weekly quota; mall outlets only inside their mall window.
            </p>
          </section>
          <section>
            <h2 className="mt-0 mb-2 text-[18px] font-semibold text-brand-ink">3. Priority order</h2>
            <ol className="m-0 pl-5">
              {p.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </section>
          <section>
            <h2 className="mt-0 mb-2 text-[18px] font-semibold text-brand-ink">4. Deferrals and their cost</h2>
            {p.deferred.length === 0 ? (
              <p className="m-0">Every order is served.</p>
            ) : (
              <table className="w-full border-collapse text-left text-[14px]">
                <thead>
                  <tr className="border-b border-line text-[12px] tracking-wide text-muted uppercase">
                    <th className="py-2 pr-3">Order</th>
                    <th className="py-2 pr-3">Reason</th>
                    <th className="py-2 pr-3">Type</th>
                    <th className="py-2">Consequence</th>
                  </tr>
                </thead>
                <tbody>
                  {p.deferred.map((d) => (
                    <tr key={d.ref} className="border-b border-line align-top">
                      <td className="py-2 pr-3">
                        <strong>{d.ref}</strong>
                        <br />
                        {d.outletName}
                      </td>
                      <td className="py-2 pr-3">
                        {REASON_CODE_LABEL[d.reasonCode]}
                        <br />
                        <span className="text-muted">{d.explanation}</span>
                      </td>
                      <td className="py-2 pr-3">{d.deferralClass === 'unavoidable' ? 'Unavoidable' : 'Choice'}</td>
                      <td className="py-2">{d.consequence}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <section>
            <h2 className="mt-0 mb-2 text-[18px] font-semibold text-brand-ink">5. Carry-over</h2>
            <p className="m-0">Deferred orders join the next operating day&apos;s queue marked &quot;skipped last run&quot; and go first. An outlet deferred twice in a row needs the dispatcher&apos;s explicit acknowledgement before publishing.</p>
          </section>
        </Card>
      ) : null}
    </>
  );
}

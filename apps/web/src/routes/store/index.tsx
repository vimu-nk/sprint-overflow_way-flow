import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/shell/app-shell';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { ChilledChip } from '@/components/ui/chip';
import { Field, Input } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState } from '@/components/ui/states';
import { outletTitle, useStoreHome } from '@/features/store/use-store';
import { post } from '@/lib/api';
import { dayMonth, fmtInt, load } from '@/lib/format';
import { notify } from '@/lib/notify';

export const Route = createFileRoute('/store/')({ component: PlaceOrder });

const DOCK: Record<string, string> = { rear_dock: 'rear dock', street: 'street', mall_bay: 'mall bay' };
const draftKey = (outletId: string) => `wayflow.draft.${outletId}`;

/** SM1 Place order (S-02, S-03): units per temperature, estimate from order history, 16:00 cutoff. */
function PlaceOrder() {
  const home = useStoreHome();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [chilled, setChilled] = useState('');
  const [ambient, setAmbient] = useState('');
  const [error, setError] = useState<string | null>(null);
  const outlet = home.data?.outlet;
  const fresh = outlet?.brand === 'Fresh';

  // Autosave the draft on this device (specs/05 §9).
  useEffect(() => {
    if (!outlet) return;
    const raw = localStorage.getItem(draftKey(outlet.outletId));
    if (raw) {
      const d = JSON.parse(raw) as { chilled: string; ambient: string };
      setChilled(d.chilled);
      setAmbient(d.ambient);
    }
  }, [outlet?.outletId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (outlet) localStorage.setItem(draftKey(outlet.outletId), JSON.stringify({ chilled, ambient }));
  }, [chilled, ambient, outlet]);

  const place = useMutation({
    mutationFn: () => post<{ orders: string[]; runDate: string; afterCutoff: boolean }>('/store/orders', { chilledUnits: Number(chilled || 0), ambientUnits: Number(ambient || 0), clientActionId: crypto.randomUUID() }),
    meta: { topLoader: true },
    onSuccess: (r) => {
      localStorage.removeItem(draftKey(outlet!.outletId));
      setChilled('');
      setAmbient('');
      notify.success(`Order ${r.orders.join(' and ')} placed`, `Goes to the ${dayMonth(r.runDate)} run. It shows Scheduled after the plan is published.`, { label: 'My deliveries', onClick: () => void navigate({ to: '/store/deliveries' }) });
      void qc.invalidateQueries({ queryKey: ['store-orders'] });
    },
    onError: (e) => notify.fail(e, 'The order was not placed. Your draft is saved on this device.'),
  });

  if (home.isError) return <ErrorState error={home.error} onRetry={() => void home.refetch()} />;
  const d = home.data;
  const c = d?.clock;
  const afterCutoff = c ? c.orderRunDate !== c.planningRunDate : false;
  const cu = Number(chilled || 0);
  const au = Number(ambient || 0);
  const kg = cu * (d?.unitProfiles.chilled?.kgPerUnit ?? 0) + au * (d?.unitProfiles.ambient?.kgPerUnit ?? 0);
  const m3 = cu * (d?.unitProfiles.chilled?.m3PerUnit ?? 0) + au * (d?.unitProfiles.ambient?.m3PerUnit ?? 0);
  const hours = c ? Math.floor(c.minutesToCutoff / 60) : 0;
  const mins = c ? c.minutesToCutoff % 60 : 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (cu + au <= 0) return setError('Enter at least one unit.');
    if (cu > 5000 || au > 5000) return setError('Enter at most 5,000 units per line.');
    setError(null);
    place.mutate();
  };
  const unitInput = (id: string, label: React.ReactNode, value: string, set: (v: string) => void, hint: string) => (
    <Field label={label} htmlFor={id} hint={hint}>
      <Input id={id} inputMode="numeric" pattern="[0-9]*" value={value} onChange={(e) => set(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="0" big />
    </Field>
  );
  const summaryRows = c && (
    <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-4 gap-y-3 text-[15px]">
      <dt className="text-muted">Delivery run</dt>
      <dd className="m-0 text-right font-medium">Goes to the {dayMonth(c.orderRunDate)} run</dd>
      <dt className="text-muted">Total units</dt>
      <dd className="m-0 text-right font-medium">{fmtInt(cu + au)}</dd>
      <dt className="text-muted">Estimated load</dt>
      <dd className="m-0 text-right font-medium">{cu + au ? load(kg, m3) : '—'}</dd>
      <dt className="text-muted">Status when placed</dt>
      <dd className="m-0 text-right font-medium">Ordered</dd>
    </dl>
  );

  return (
    <form onSubmit={submit} noValidate className="pb-24 lg:pb-0">
      <PageHeader
        title="Place Order"
        subtitle={outlet ? `${outletTitle(outlet)}. Order by 16:00 to be on the next morning's run.` : <Skeleton className="h-5 w-80" />}
        action={
          c && !afterCutoff ? (
            <span className="inline-flex h-9 items-center rounded-full bg-brand-tint px-3 text-[14px] font-medium text-ok" aria-live="polite">
              Cutoff in {hours ? `${hours} h ` : ''}
              {mins} min
            </span>
          ) : undefined
        }
      />
      {afterCutoff && c && (
        <Banner tone="warning" className="mb-6" title="The 16:00 cutoff has passed">
          An order placed now goes to the {dayMonth(c.orderRunDate)} run, not the {dayMonth(c.planningRunDate)} run.
        </Banner>
      )}
      {home.isPending ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <Skeleton className="h-80 rounded-card" />
          <Skeleton className="h-56 rounded-card" />
        </div>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[1fr_380px]">
          <Card className="flex flex-col gap-5 p-6">
            <CardTitle>Order Details</CardTitle>
            {fresh ? (
              <>
                {unitInput(
                  'chilled',
                  <span className="inline-flex items-center gap-2">
                    Chilled units <ChilledChip />
                  </span>,
                  chilled,
                  setChilled,
                  'Chilled goods travel on a refrigerated vehicle.',
                )}
                {unitInput('ambient', 'Ambient units', ambient, setAmbient, 'Dry goods. A refrigerated vehicle can carry them too.')}
              </>
            ) : (
              unitInput('ambient', 'Units', ambient, setAmbient, outlet?.brand === 'Style' ? 'Hanging garments and cartons.' : 'Appliances and electronics.')
            )}
            <p className="m-0 text-[15px]">
              <span className="text-muted">Delivery window</span> {outlet?.windowOpen} to {outlet?.windowClose}, {DOCK[outlet?.dockType ?? ''] ?? ''}
              {outlet?.mallWindow ? `. Mall window ${outlet.mallWindow}` : ''}
            </p>
            {error && (
              <p role="alert" className="m-0 text-[14px] text-danger">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" className="hidden self-start lg:inline-flex" loading={place.isPending}>
              Place order
            </Button>
          </Card>
          <Card className="flex flex-col gap-4 p-6">
            <CardTitle>Summary</CardTitle>
            {summaryRows}
            <p className="m-0 text-[14px] text-muted">The dispatcher plans the run. Your order shows Scheduled after the plan is published.</p>
            <Link to="/store/deliveries" className="text-[14px]">
              See my deliveries
            </Link>
          </Card>
        </div>
      )}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white px-4 pt-4 safe-bottom lg:hidden">
        <Button type="submit" size="xl" block loading={place.isPending}>
          Place order
        </Button>
      </div>
    </form>
  );
}

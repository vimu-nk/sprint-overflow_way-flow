import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import type { OrderDto } from '@wayflow/shared';
import { BRANDS, DEPOTS } from '@wayflow/shared';
import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/shell/app-shell';
import { Breadcrumbs } from '@/components/shell/breadcrumbs';
import { Card, CardTitle } from '@/components/ui/card';
import { ChilledChip, MallChip, SkippedChip, VanChip } from '@/components/ui/chip';
import { Select } from '@/components/ui/form';
import { OrderPill } from '@/components/ui/pill';
import { SkeletonRows } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState, ErrorState } from '@/components/ui/states';
import { useRunDate } from '@/features/dispatcher/run-date';
import { get } from '@/lib/api';
import { dayMonth, fmtInt, load, longDate } from '@/lib/format';

export const Route = createFileRoute('/dispatcher/queue')({
  validateSearch: (s: Record<string, unknown>): { date?: string; q?: string } => ({
    date: typeof s.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.date) ? s.date : undefined,
    q: typeof s.q === 'string' ? s.q.slice(0, 40) : undefined,
  }),
  component: Queue,
});

/** D1 Order queue: every order for the run, filterable by depot, brand, district, temperature and access. */
function Queue() {
  const search = Route.useSearch();
  const runDate = useRunDate(search.date);
  const [depot, setDepot] = useState('');
  const [brand, setBrand] = useState('');
  const [district, setDistrict] = useState('');
  const [temp, setTemp] = useState('');
  const [access, setAccess] = useState('');
  const q = useQuery({ queryKey: ['orders', runDate], queryFn: () => get<{ runDate: string; orders: OrderDto[]; lateOrders: OrderDto[] }>(`/dispatcher/orders?date=${runDate}`), enabled: !!runDate });
  const all = q.data?.orders ?? [];
  const districts = useMemo(() => [...new Set(all.map((o) => o.outlet.district))].sort(), [all]);
  const text = search.q?.toLowerCase();
  const rows = all.filter(
    (o) =>
      (!depot || o.outlet.depot === depot) &&
      (!brand || o.outlet.brand === brand) &&
      (!district || o.outlet.district === district) &&
      (!temp || o.temp === temp) &&
      (!access || (access === 'van_only' ? o.outlet.parkingConstraint === 'van_only' : access === 'mall' ? !!o.outlet.mallWindow : o.deferredYesterday)) &&
      (!text || o.ref.toLowerCase().includes(text) || o.outlet.outletId.toLowerCase().includes(text) || o.outlet.name.toLowerCase().includes(text) || (o.tripKey ?? '').toLowerCase().includes(text)),
  );
  const late = q.data?.lateOrders ?? [];
  const cancelled = all.filter((o) => o.status === 'cancelled').length;
  const onRun = all.length - cancelled;
  const kgTotal = rows.reduce((a, o) => a + o.weightKg, 0);
  const m3Total = rows.reduce((a, o) => a + o.volumeM3, 0);
  return (
    <>
      <Breadcrumbs items={[{ label: 'Dispatcher', to: '/dispatcher' }, { label: 'Order queue' }]} />
      <PageHeader
        title="Order Queue"
        subtitle={runDate && q.data ? `${longDate(runDate)} run. ${all.length + late.length} orders: ${onRun} on the run, ${late.length} placed after the 4 PM cutoff, ${cancelled} cancelled.` : <Spinner />}
      />
      <Card className="p-5">
        <CardTitle aside={<span className="text-[13px] text-muted">{rows.length ? `${load(kgTotal, m3Total)} shown` : ''}</span>}>All Orders ({rows.length})</CardTitle>
        <div className="mt-4 grid gap-2 sm:grid-cols-3 xl:grid-cols-5">
          <Select aria-label="Depot" value={depot} onChange={(e) => setDepot(e.target.value)}>
            <option value="">All depots</option>
            {DEPOTS.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </Select>
          <Select aria-label="Brand" value={brand} onChange={(e) => setBrand(e.target.value)}>
            <option value="">All brands</option>
            {BRANDS.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </Select>
          <Select aria-label="District" value={district} onChange={(e) => setDistrict(e.target.value)}>
            <option value="">All districts</option>
            {districts.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </Select>
          <Select aria-label="Temperature" value={temp} onChange={(e) => setTemp(e.target.value)}>
            <option value="">Chilled and ambient</option>
            <option value="chilled">Chilled</option>
            <option value="ambient">Ambient</option>
          </Select>
          <Select aria-label="Access and history" value={access} onChange={(e) => setAccess(e.target.value)}>
            <option value="">All rules</option>
            <option value="van_only">Van only</option>
            <option value="mall">Mall window</option>
            <option value="skipped">Skipped last run</option>
          </Select>
        </div>
        {q.isPending ? (
          <div className="mt-4">
            <SkeletonRows rows={8} />
          </div>
        ) : q.isError ? (
          <div className="mt-4">
            <ErrorState error={q.error} onRetry={() => void q.refetch()} />
          </div>
        ) : rows.length === 0 ? (
          <div className="mt-4">
            <EmptyState title="No orders match" body="Change the filters, or wait for stores to place orders before the 16:00 cutoff." />
          </div>
        ) : (
          <>
            {/* Table on desktop, cards below md (specs/05 §1). */}
            <div className="mt-4 hidden overflow-x-auto md:block">
              <table className="w-full border-collapse text-left text-[14px]">
                <thead>
                  <tr className="bg-canvas text-[12px] tracking-wide text-muted uppercase">
                    <th className="px-3 py-2.5 font-semibold">Order</th>
                    <th className="px-3 py-2.5 font-semibold">Outlet</th>
                    <th className="px-3 py-2.5 font-semibold">Load</th>
                    <th className="px-3 py-2.5 font-semibold">Window</th>
                    <th className="px-3 py-2.5 font-semibold">Rules</th>
                    <th className="px-3 py-2.5 font-semibold">Trip</th>
                    <th className="px-3 py-2.5 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((o) => (
                    <tr key={o.id} className="border-b border-line align-top">
                      <td className="px-3 py-3 font-semibold text-link">{o.ref}</td>
                      <td className="px-3 py-3">
                        <Link to="/dispatcher/outlets/$outletId" params={{ outletId: o.outlet.outletId }} className="text-ink">
                          {o.outlet.name}
                        </Link>
                        <p className="m-0 text-[13px] text-muted">{o.outlet.outletId}</p>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">{load(o.weightKg, o.volumeM3)}</td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {o.outlet.windowOpen} to {o.outlet.windowClose}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          {o.temp === 'chilled' && <ChilledChip />}
                          {o.outlet.parkingConstraint === 'van_only' && <VanChip />}
                          {o.outlet.mallWindow && <MallChip />}
                          {o.deferredYesterday && <SkippedChip />}
                        </div>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">{o.tripKey ?? <span className="text-muted">Not planned</span>}</td>
                      <td className="px-3 py-3">
                        <OrderPill status={o.status} />
                        {o.lastUpdateAt && <p className="m-0 mt-1 text-[12px] text-muted">On the road</p>}
                      </td>
                    </tr>
                  ))}
                  {late.map((o) => (
                    <tr key={o.id} className="border-b border-line align-top">
                      <td className="px-3 py-3 font-semibold text-link">{o.ref}</td>
                      <td className="px-3 py-3">
                        {o.outlet.name}
                        <p className="m-0 text-[13px] text-muted">{o.outlet.outletId}</p>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">{load(o.weightKg, o.volumeM3)}</td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {o.outlet.windowOpen} to {o.outlet.windowClose}
                      </td>
                      <td className="px-3 py-3" />
                      <td className="px-3 py-3 text-muted">Not planned</td>
                      <td className="px-3 py-3">
                        <OrderPill status={o.status} />
                        <p className="m-0 mt-1 text-[12px] text-muted">Goes to the {dayMonth(o.runDate)} run</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="mt-4 flex list-none flex-col gap-2 p-0 md:hidden">
              {rows.map((o) => (
                <li key={o.id} className="rounded-card border border-line p-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-link">{o.ref}</span>
                    <OrderPill status={o.status} />
                  </div>
                  <p className="m-0 text-[14px]">
                    {o.outlet.name} · {o.outlet.outletId}
                  </p>
                  <p className="m-0 text-[13px] text-muted">
                    {load(o.weightKg, o.volumeM3)} · {o.outlet.windowOpen} to {o.outlet.windowClose} · {o.tripKey ?? 'Not planned'}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {o.temp === 'chilled' && <ChilledChip />}
                    {o.outlet.parkingConstraint === 'van_only' && <VanChip />}
                    {o.deferredYesterday && <SkippedChip />}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="mt-4 mb-0 text-[13px] text-muted">
          Totals: {fmtInt(all.filter((o) => o.temp === 'chilled').length)} chilled, {fmtInt(all.filter((o) => o.temp === 'ambient').length)} ambient ·{' '}
          {BRANDS.map((b) => `${b} ${all.filter((o) => o.outlet.brand === b).length}`).join(', ')}
        </p>
      </Card>
    </>
  );
}

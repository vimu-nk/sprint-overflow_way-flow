import { Link } from '@tanstack/react-router';
import type { OrderDto } from '@wayflow/shared';
import { ChilledChip, VanChip } from '@/components/ui/chip';
import { OrderPill } from '@/components/ui/pill';
import { fmtInt, hhmm } from '@/lib/format';

const arrival = (o: OrderDto) =>
  o.deliveredAt ? hhmm(o.deliveredAt) : o.eta ? `${o.eta}, estimated` : o.plannedArrival ? `${o.plannedArrival}, plan` : 'Not scheduled';

/** SM2 table on desktop and stacked cards on phones (specs/05 §1). */
export function DeliveryTable({ orders, title }: { orders: OrderDto[]; title: string }) {
  const delivered = orders.some((o) => o.deliveredAt);
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse text-left text-[15px]" aria-label={title}>
          <thead>
            <tr className="bg-canvas text-[12px] tracking-wide text-muted uppercase">
              <th className="px-3 py-3 font-semibold">Order</th>
              <th className="px-3 py-3 font-semibold">Contents</th>
              <th className="px-3 py-3 text-right font-semibold">Units</th>
              <th className="px-3 py-3 font-semibold">Window</th>
              <th className="px-3 py-3 font-semibold">{delivered ? 'Delivered' : 'Planned arrival'}</th>
              <th className="px-3 py-3 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-b border-line align-top">
                <td className="px-3 py-4">
                  <Link to="/store/orders/$orderId" params={{ orderId: o.id }} className="font-semibold">
                    {o.ref}
                  </Link>
                </td>
                <td className="px-3 py-4">
                  <div className="flex flex-wrap gap-1.5">
                    {o.temp === 'chilled' ? <ChilledChip /> : <span className="text-muted">Ambient</span>}
                    {o.outlet.parkingConstraint === 'van_only' && <VanChip />}
                  </div>
                </td>
                <td className="px-3 py-4 text-right">{fmtInt(o.units)}</td>
                <td className="px-3 py-4 whitespace-nowrap">
                  {o.outlet.windowOpen} to {o.outlet.windowClose}
                </td>
                <td className="px-3 py-4 whitespace-nowrap">
                  {arrival(o)}
                  {o.lateRisk && !o.deliveredAt && <p className="m-0 text-[13px] text-warn">Late risk</p>}
                </td>
                <td className="px-3 py-4">
                  <OrderPill status={o.status} />
                  {o.lastUpdateAt && <p className="m-0 mt-1 text-[13px] text-muted">Last update {hhmm(o.lastUpdateAt)}</p>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="m-0 flex list-none flex-col gap-3 p-0 md:hidden">
        {orders.map((o) => (
          <li key={o.id}>
            <Link to="/store/orders/$orderId" params={{ orderId: o.id }} className="block rounded-card border border-line bg-white p-4 text-ink no-underline">
              <div className="flex items-start justify-between gap-2">
                <span className="text-[17px] font-semibold">{o.ref}</span>
                <OrderPill status={o.status} />
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {o.temp === 'chilled' ? <ChilledChip /> : <span className="text-[14px] text-muted">Ambient</span>}
                {o.outlet.parkingConstraint === 'van_only' && <VanChip />}
              </div>
              <dl className="m-0 mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[15px]">
                <dt className="text-muted">Units</dt>
                <dd className="m-0 text-right">{fmtInt(o.units)}</dd>
                <dt className="text-muted">Window</dt>
                <dd className="m-0 text-right">
                  {o.outlet.windowOpen} to {o.outlet.windowClose}
                </dd>
                <dt className="text-muted">{o.deliveredAt ? 'Delivered' : 'Planned arrival'}</dt>
                <dd className="m-0 text-right">{arrival(o)}</dd>
                {o.lastUpdateAt && (
                  <>
                    <dt className="text-muted">Last update</dt>
                    <dd className="m-0 text-right">{hhmm(o.lastUpdateAt)}</dd>
                  </>
                )}
              </dl>
              {o.status === 'deferred' && o.decision?.storeReason && <p className="m-0 mt-2 text-[14px] text-warn">Reason: {o.decision.storeReason}.</p>}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

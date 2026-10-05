import { createFileRoute, Link } from '@tanstack/react-router';
import { PROBLEM_KIND_LABEL } from '@wayflow/shared';
import { FieldShell } from '@/components/shell/field-shell';
import { Breadcrumbs } from '@/components/shell/breadcrumbs';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/pill';
import { useRun } from '@/features/field/use-run';
import { hhmm } from '@/lib/format';
import type { OutboxItem } from '@/lib/offline/db';
import { isUnsent } from '@/lib/offline/field-data';
import { discard, flush, retryAll, useSyncState } from '@/lib/offline/sync';

export const Route = createFileRoute('/driver/sync')({ component: OfflineSync });

/** DR4 Offline and Sync (R-04, degradation screen 1): what is waiting, sending, sent or needs attention. */
function OfflineSync() {
  const { me } = Route.useRouteContext();
  const { current: t, outbox, trips } = useRun(me);
  const s = useSyncState();
  const stopName = (id: string) => trips.flatMap((x) => x.stops).find((x) => x.id === id);
  const waiting = outbox.filter(isUnsent);
  const attention = outbox.filter((o) => o.status === 'rejected' || o.status === 'conflict');
  const sent = outbox.filter((o) => o.status === 'applied').slice(-10).reverse();
  const late = t?.stops.filter((x) => (x.status === 'pending' || x.status === 'arrived') && x.late) ?? [];

  const describe = (o: OutboxItem) => {
    const a = o.action;
    switch (a.type) {
      case 'stop.outcome': {
        const st = stopName(a.stopId);
        return { title: 'Stop record', body: `${st?.outlet.name ?? ''} ${st?.outlet.outletId ?? ''}, order ${st?.order.ref ?? ''}. ${a.outcome === 'delivered' ? 'Delivered' : a.outcome === 'partial' ? 'Partly delivered' : 'Not delivered'} ${hhmm(o.createdAtClient)}.${a.recipientName ? ` Received by ${a.recipientName}.` : ''}${a.hasPhoto ? ' Photo attached.' : ''}` };
      }
      case 'problem.report':
        return { title: 'Problem report', body: `${PROBLEM_KIND_LABEL[a.kind]}${a.delayMin ? `, about ${a.delayMin} min` : ''}. Saved at ${hhmm(o.createdAtClient)}. ${a.note}` };
      case 'trip.start':
        return { title: 'Trip start', body: `Started at ${hhmm(o.createdAtClient)}.` };
      case 'stop.arrive':
        return { title: 'Arrival', body: `Arrived ${hhmm(o.createdAtClient)}.` };
      default:
        return { title: a.type, body: hhmm(o.createdAtClient) };
    }
  };
  const list = (items: OutboxItem[], label: (o: OutboxItem) => React.ReactNode) => (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {items.map((o) => {
        const d = describe(o);
        return (
          <li key={o.clientActionId}>
            <Card className="flex flex-col gap-1 p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{d.title}</span>
                {label(o)}
              </div>
              <p className="m-0 text-[15px] text-muted">{d.body}</p>
              {o.message && o.status !== 'applied' && <p className="m-0 text-[14px] text-warn">{o.message}</p>}
              {o.status === 'rejected' && o.action.type !== 'stop.outcome' && (
                <Button size="sm" variant="ghost" className="self-start" onClick={() => void discard(o.seq!)}>
                  Discard
                </Button>
              )}
            </Card>
          </li>
        );
      })}
    </ul>
  );
  return (
    <FieldShell
      me={me}
      syncTo="/driver/sync"
      bottom={
        <Link to="/driver">
          <Button size="xl" block variant={waiting.length ? 'secondary' : 'primary'}>
            Return to run
          </Button>
        </Link>
      }
    >
      <Breadcrumbs items={[{ label: 'My run', to: '/driver' }, { label: 'Offline and sync' }]} />
      <h1 className="m-0 text-[28px] leading-9 font-bold text-brand-ink">Offline and Sync</h1>
      <p className="mt-1 mb-4 text-[16px] text-muted">{t ? `${t.key}, ${t.district}` : ''}</p>
      <div className="flex flex-col gap-5">
        {s.online && s.syncing && <Banner tone="info" title="Signal is back" live>Sending {waiting.length} item{waiting.length === 1 ? '' : 's'} now.</Banner>}
        {s.online && !s.syncing && !waiting.length && s.lastSyncAt && <Banner tone="success" title={`Synced at ${hhmm(s.lastSyncAt)}`} live>{attention.length ? `${attention.length} item${attention.length > 1 ? 's' : ''} need attention.` : 'The office has your update.'}</Banner>}
        {waiting.length > 0 && (
          <section>
            <h2 className="mt-0 mb-3 text-[17px] font-semibold">
              {s.syncing ? 'Sending' : 'Waiting to send'} ({waiting.length})
            </h2>
            {list(waiting, () => <Pill tone="warning">{s.syncing ? 'Syncing' : 'Not synced yet'}</Pill>)}
            {!s.online && <p className="mt-3 mb-0 text-[15px] text-muted">The office still sees this run as of {hhmm(s.lastSyncAt ?? t?.lastSignalAt ?? null) || 'your last sync'}. These items send by themselves when signal returns.</p>}
            {s.online && !s.syncing && (
              <Button className="mt-3" variant="secondary" onClick={() => void flush(true)}>
                Send now
              </Button>
            )}
          </section>
        )}
        {attention.length > 0 && (
          <section>
            <h2 className="mt-0 mb-3 text-[17px] font-semibold">Needs attention ({attention.length})</h2>
            {list(attention, (o) => <Pill tone={o.status === 'conflict' ? 'warning' : 'danger'}>{o.status === 'conflict' ? 'Kept, under review' : 'Not accepted'}</Pill>)}
            <Button className="mt-3" variant="secondary" onClick={() => void retryAll()}>
              Retry all
            </Button>
          </section>
        )}
        {late.length > 0 && s.online && (
          <section>
            <h2 className="mt-0 mb-3 text-[17px] font-semibold">New arrival times</h2>
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {late.map((x) => (
                <li key={x.id}>
                  <Card className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-semibold">
                        {x.outlet.name} ({x.outlet.outletId})
                      </span>
                      <Pill tone="warning">Late risk</Pill>
                    </div>
                    <p className="m-0 text-[15px]">New arrival {x.eta ?? x.plannedArrival}</p>
                    <p className="m-0 text-[15px] text-muted">Window closes {x.outlet.windowClose}.</p>
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        )}
        {sent.length > 0 && (
          <section>
            <h2 className="mt-0 mb-3 text-[17px] font-semibold">Sent</h2>
            {list(sent, () => <Pill tone="success">Sent</Pill>)}
          </section>
        )}
        {!waiting.length && !attention.length && !sent.length && <p className="m-0 text-muted">Nothing waiting. Everything you record is saved on this phone first and sent as soon as there is signal.</p>}
      </div>
    </FieldShell>
  );
}

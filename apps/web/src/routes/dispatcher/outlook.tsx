import { createFileRoute } from '@tanstack/react-router';
import { BarChart3 } from 'lucide-react';
import { PageHeader } from '@/components/shell/app-shell';
import { Breadcrumbs } from '@/components/shell/breadcrumbs';
import { Card } from '@/components/ui/card';

export const Route = createFileRoute('/dispatcher/outlook')({ component: Outlook });

/** D6 Capacity outlook: a placeholder in the Designathon design; forecasting belongs to the Datathon. */
function Outlook() {
  return (
    <>
      <Breadcrumbs items={[{ label: 'Dispatcher', to: '/dispatcher' }, { label: 'Outlook' }]} />
      <PageHeader title="Capacity Outlook" subtitle="Low fidelity placeholder. This screen is planned for a later stage." />
      <Card className="flex flex-col items-start gap-2 p-6">
        <BarChart3 className="size-8 text-muted" aria-hidden />
        <h2 className="m-0 text-[18px] font-semibold text-brand-ink">Forecast</h2>
        <p className="m-0 text-muted">Forecasts arrive from the Datathon model.</p>
        <p className="m-0 text-muted">Expected demand and fleet capacity will show here once the model is connected.</p>
      </Card>
    </>
  );
}

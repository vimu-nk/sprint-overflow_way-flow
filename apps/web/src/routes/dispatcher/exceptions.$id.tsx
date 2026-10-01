import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ExceptionPanel } from '@/features/dispatcher/exception-panel';

export const Route = createFileRoute('/dispatcher/exceptions/$id')({ component: ExceptionPage });

/** Deep link target for exception notifications. */
function ExceptionPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  return <ExceptionPanel id={id} onClose={() => void navigate({ to: '/dispatcher/exceptions' })} />;
}

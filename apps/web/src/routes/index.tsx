import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import type { Health } from '@wayflow/shared';

export const Route = createFileRoute('/')({
  component: Home,
});

function Home() {
  const { data, isError } = useQuery({
    queryKey: ['health'],
    queryFn: async (): Promise<Health> => {
      const res = await fetch('/api/health');
      if (!res.ok) throw new Error(`API ${res.status}`);
      return res.json();
    },
  });

  return (
    <main className="mx-auto max-w-xl p-6">
      <h1 className="text-2xl font-bold">WayFlow</h1>
      <p className="mt-2 text-sm text-neutral-600">
        API: {isError ? 'unreachable' : (data?.status ?? 'checking…')}
      </p>
    </main>
  );
}

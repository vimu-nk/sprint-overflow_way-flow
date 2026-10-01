import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router';
import { ROLE_HOME } from '@wayflow/shared';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Logo } from '@/components/shell/logo';
import { logout } from '@/components/shell/logout';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form';
import { Pill } from '@/components/ui/pill';
import { SkeletonRows } from '@/components/ui/skeleton';
import { del, get, post } from '@/lib/api';
import { hhmm } from '@/lib/format';
import { notify } from '@/lib/notify';
import { meQuery } from '@/lib/session';

export const Route = createFileRoute('/profile')({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQuery).catch(() => null);
    if (!me) throw redirect({ to: '/', search: { next: '/profile' } });
    return { me };
  },
  component: Profile,
});

/** Profile: active sessions with revoke (SEC-19), change password (SEC-07), sign out everywhere (SEC-15). */
function Profile() {
  const { me } = Route.useRouteContext();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => get<{ id: string; device: string; lastUsedAt: string; current: boolean }[]>('/auth/sessions') });
  const revoke = useMutation({
    mutationFn: (id: string) => del(`/auth/sessions/${id}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['sessions'] }),
    onError: (e) => notify.fail(e, 'Could not end that session'),
  });
  const change = useMutation({
    mutationFn: () => post('/auth/password', { currentPassword: current, newPassword: next }),
    onSuccess: () => {
      notify.success('Password changed', 'Your other sessions were signed out.');
      setCurrent('');
      setNext('');
      void qc.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: (e) => notify.fail(e, 'Password not changed'),
  });
  const everywhere = useMutation({
    mutationFn: () => post('/auth/logout-all'),
    onSuccess: async () => {
      await logout(qc, me.id);
      void navigate({ to: '/' });
    },
  });
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="flex h-16 items-center gap-3 border-b border-line bg-white px-4">
        <Link to={ROLE_HOME[me.role]} className="grid size-11 place-items-center rounded-control hover:bg-chip" aria-label="Back">
          <ArrowLeft className="size-5" aria-hidden />
        </Link>
        <Logo />
      </header>
      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-6">
        <div>
          <h1 className="m-0 text-[28px] font-bold text-brand-ink">{me.name}</h1>
          <p className="m-0 text-muted">
            {me.email} · {me.role.replace('_', ' ')}
            {me.depot ? ` · ${me.depot}` : ''}
            {me.vehicleId ? ` · ${me.vehicleId}` : ''}
            {me.outlet ? ` · ${me.outlet.outletId}` : ''}
          </p>
        </div>
        <Card className="p-5">
          <CardTitle>Signed-in devices</CardTitle>
          {sessions.isPending ? (
            <div className="mt-3">
              <SkeletonRows rows={2} />
            </div>
          ) : (
            <ul className="m-0 mt-3 flex list-none flex-col divide-y divide-line p-0">
              {(sessions.data ?? []).map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 py-3">
                  <span className="min-w-0">
                    <span className="block truncate text-[14px]">{s.device}</span>
                    <span className="text-[13px] text-muted">Last used {hhmm(s.lastUsedAt)}</span>
                  </span>
                  {s.current ? (
                    <Pill tone="success">This device</Pill>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => revoke.mutate(s.id)}>
                      Sign out
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <Button className="mt-3" variant="secondary" loading={everywhere.isPending} onClick={() => everywhere.mutate()}>
            Sign out everywhere
          </Button>
        </Card>
        <Card className="p-5">
          <CardTitle>Change password</CardTitle>
          <form
            className="mt-3 flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              change.mutate();
            }}
          >
            <Field label="Current password" htmlFor="pw-current">
              <Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </Field>
            <Field label="New password" htmlFor="pw-new" hint="At least 12 characters. Any characters, spaces welcome. Common passwords are refused.">
              <Input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} minLength={12} maxLength={128} />
            </Field>
            <Button type="submit" loading={change.isPending} disabled={!current || next.length < 12}>
              Change password
            </Button>
          </form>
        </Card>
      </main>
    </div>
  );
}

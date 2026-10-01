import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router';
import { ROLE_HOME, type Role } from '@wayflow/shared';
import { useState } from 'react';
import { HeroVideo } from '@/features/auth/hero';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { ApiError, post } from '@/lib/api';
import { meQuery, safeNext } from '@/lib/session';

export const Route = createFileRoute('/')({
  validateSearch: (s: Record<string, unknown>): { next?: string } => ({ next: safeNext(s.next) ?? undefined }),
  beforeLoad: async ({ context, search }) => {
    const me = await context.queryClient.ensureQueryData(meQuery).catch(() => null);
    if (me) throw redirect({ to: search.next ?? ROLE_HOME[me.role] });
  },
  component: Login,
});

const STEPS = ['Store order confirmed', 'Dispatch plan created', 'Vehicle loaded', 'Delivery received'];

function Login() {
  const { next } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email || !password) {
      setError('Enter your work email and password.');
      return;
    }
    setBusy(true);
    try {
      const { role } = await post<{ role: Role }>('/auth/login', { email, password });
      await qc.invalidateQueries({ queryKey: ['me'] });
      await qc.fetchQuery(meQuery);
      void navigate({ to: next ?? ROLE_HOME[role] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign in failed. Try again.');
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-canvas lg:flex-row">
      {/* Hero panel: the Figma green panel, replaced by the truck video with a shaded text side. */}
      <section className="relative isolate flex min-h-[340px] flex-col justify-between overflow-hidden px-5 py-6 text-white sm:px-10 sm:py-8 lg:min-h-dvh lg:w-[39%] lg:shrink-0 lg:px-12 lg:py-12">
        <HeroVideo className="absolute inset-0 -z-20" />
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,rgba(0,0,0,.55)_0%,rgba(0,0,0,.35)_40%,rgba(0,0,0,.75)_100%)] lg:bg-[linear-gradient(90deg,rgba(9,28,21,.82)_0%,rgba(9,28,21,.6)_60%,rgba(9,28,21,.35)_100%)]" />
        <div className="flex items-center gap-3">
          <span className="size-[26px] rounded-[6px] bg-white" aria-hidden />
          <span className="text-[15px] font-bold tracking-[0.04em]">WAYPOINT</span>
        </div>
        <div className="my-6 flex flex-col gap-5 [text-shadow:0_1px_2px_rgba(0,0,0,.6)] lg:my-0">
          <h1 className="m-0 text-[28px] leading-[36px] font-semibold tracking-[-0.01em] sm:text-[36px] sm:leading-[48px] lg:text-[40px] lg:leading-[52px]">
            One delivery day.
            <br />
            Every handoff connected.
          </h1>
          <p className="m-0 max-w-md text-[16px] leading-6 text-white/85">Coordinate ordering, dispatch, loading, delivery, and store receipt from one shared system.</p>
          <ol className="m-0 hidden list-none flex-col gap-4 p-0 sm:flex">
            {STEPS.map((s, i) => (
              <li key={s} className="flex items-center gap-3 text-[15px] font-medium">
                <span className={i === 0 ? 'grid size-7 place-items-center rounded-full bg-white text-[13px] font-semibold text-brand' : 'grid size-7 place-items-center rounded-full bg-black/60 text-[13px] font-semibold text-white'}>{i + 1}</span>
                {s}
              </li>
            ))}
          </ol>
        </div>
        <p className="m-0 hidden text-[13px] text-white/75 lg:block">Secure access for Waypoint operations</p>
      </section>

      <section className="flex flex-1 flex-col items-center justify-center px-4 py-8 sm:px-8">
        <div className="w-full max-w-[486px] rounded-card border border-line bg-white px-6 py-8 sm:px-14 sm:py-12">
          <h2 className="m-0 text-[28px] leading-9 font-semibold text-brand-ink">Welcome back</h2>
          <p className="mt-3 mb-6 text-[15px] text-muted">Sign in to continue to your Waypoint workspace.</p>
          <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
            <Field label="Work email" htmlFor="email">
              <Input id="email" type="email" autoComplete="username" inputMode="email" placeholder="name@waypoint.lk" value={email} onChange={(e) => setEmail(e.target.value)} big aria-invalid={!!error} />
            </Field>
            <Field label="Password" htmlFor="password">
              <Input id="password" type="password" autoComplete="current-password" placeholder="Enter your password" value={password} onChange={(e) => setPassword(e.target.value)} big aria-invalid={!!error} />
            </Field>
            <div className="flex justify-end">
              <Link to="/forgot-password" className="text-[14px] font-medium text-ink">
                Forgot password?
              </Link>
            </div>
            {error && (
              <p role="alert" className="m-0 rounded-control bg-danger-tint px-3 py-2 text-[14px] text-danger">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" block loading={busy}>
              Sign in
            </Button>
          </form>
          <div className="mt-6 border-t border-line pt-5 text-center text-[14px] text-muted">Need access? Contact your operations administrator.</div>
        </div>
      </section>
    </div>
  );
}

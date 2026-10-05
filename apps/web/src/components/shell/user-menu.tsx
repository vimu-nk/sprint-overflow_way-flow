import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import type { MeDto } from '@wayflow/shared';
import { LogOut, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { firstName, initials } from '@/lib/format';
import { flush } from '@/lib/offline/sync';
import { logout, pendingCount } from './logout';

export function Avatar({ name, soft }: { name: string; soft?: boolean }) {
  return (
    <span className={soft ? 'grid size-10 place-items-center rounded-full bg-brand-tint text-[14px] font-semibold text-brand' : 'grid size-10 place-items-center rounded-full bg-brand text-[14px] font-semibold text-white'} aria-hidden>
      {initials(name)}
    </span>
  );
}

export function UserMenu({ me, soft }: { me: MeDto; soft?: boolean }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const signOut = async (force = false) => {
    if (!force && (me.role === 'driver' || me.role === 'loader')) {
      const n = await pendingCount(me.id);
      if (n) {
        setPending(n);
        return;
      }
    }
    await logout(qc, me.id);
    void navigate({ to: '/' });
  };

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex min-h-11 items-center gap-2 rounded-full pr-2 hover:bg-chip" aria-expanded={open} aria-haspopup="menu">
        <Avatar name={me.name} soft={soft} />
        <span className="hidden text-[15px] font-medium text-ink sm:inline">{firstName(me.name)}</span>
      </button>
      {open && (
        <div role="menu" className="absolute top-12 right-0 z-50 w-56 rounded-card border border-line bg-white p-1 shadow-lg">
          <p className="m-0 truncate px-3 py-2 text-[13px] text-muted">{me.email}</p>
          <Link to="/profile" role="menuitem" className="flex min-h-11 items-center gap-2 rounded-control px-3 text-ink no-underline hover:bg-chip" onClick={() => setOpen(false)}>
            <UserRound className="size-4" aria-hidden /> Profile and sessions
          </Link>
          <button type="button" role="menuitem" onClick={() => void signOut()} className="flex min-h-11 w-full items-center gap-2 rounded-control px-3 text-left text-ink hover:bg-chip">
            <LogOut className="size-4" aria-hidden /> Sign out
          </button>
        </div>
      )}
      <Dialog open={pending > 0} onClose={() => setPending(0)} title={`${pending} action${pending > 1 ? 's' : ''} not synced`}>
        <p className="mt-0 text-[15px]">These records are only on this device. Send them before you sign out, or keep them here: they stay locked to your account and send next time you sign in.</p>
        <div className="flex flex-col gap-2">
          <Button
            onClick={async () => {
              await flush(true);
              setPending(0);
            }}
          >
            Sync now
          </Button>
          <Button variant="secondary" onClick={() => void signOut(true)}>
            Keep for later and sign out
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

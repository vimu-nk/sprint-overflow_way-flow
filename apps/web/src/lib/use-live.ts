import { useQueryClient } from '@tanstack/react-query';
import type { MeDto } from '@wayflow/shared';
import { useEffect } from 'react';
import { connectLive } from './live';
import { onSessionExpired } from './api';
import { startSync } from './offline/sync';
import { notify } from './notify';
import { useNavigate } from '@tanstack/react-router';

/** Per-role runtime: live stream for everyone, offline sync engine for field roles. */
export function useRoleRuntime(me: MeDto, opts: { field?: boolean; quiet?: () => boolean } = {}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  useEffect(() => {
    if (!navigator.onLine && opts.field) return;
    return connectLive(qc, { quiet: opts.quiet });
  }, [qc, me.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => (opts.field ? startSync(me.id, qc) : undefined), [qc, me.id, opts.field]);
  useEffect(
    () =>
      onSessionExpired(() => {
        // SEC-74: an expired session never wipes queued field work; sign in again to send it.
        if (opts.field && !navigator.onLine) return;
        notify.warning('Your session has ended', 'Sign in again to continue. Unsent work stays on this device.');
        void navigate({ to: '/', search: { next: window.location.pathname } });
      }),
    [navigate, opts.field],
  );
}

import { toast } from 'sonner';
import { ApiError } from './api';

/**
 * One toast API for the whole app (specs/05 §5). Success 4 s, errors 8 s with what to do next,
 * offline-queued messages persist until dismissed.
 */
type Action = { label: string; onClick: () => void };

export const notify = {
  success: (title: string, description?: string, action?: Action) => toast.success(title, { description, action, duration: 4000 }),
  info: (title: string, description?: string, action?: Action) => toast.info(title, { description, action, duration: 4000 }),
  warning: (title: string, description?: string, action?: Action) => toast.warning(title, { description, action, duration: 6000 }),
  error: (title: string, description?: string, action?: Action) => toast.error(title, { description, action, duration: 8000 }),
  queued: (title: string, description?: string) => toast(title, { description, duration: Infinity, closeButton: true }),
  /** Map any thrown value to a human message; never show raw API errors. */
  fail: (e: unknown, fallback = 'That did not work.') => {
    const msg = e instanceof ApiError ? e.message : fallback;
    toast.error(fallback === msg ? msg : fallback, { description: fallback === msg ? undefined : msg, duration: 8000 });
  },
  promise: <T,>(p: Promise<T>, m: { loading: string; success: string; error?: string }) =>
    toast.promise(p, { loading: m.loading, success: m.success, error: (e: unknown) => (e instanceof ApiError ? e.message : (m.error ?? 'That did not work.')) }),
};

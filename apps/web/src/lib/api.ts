// Typed fetch wrapper. Cookies carry the session (httpOnly); the CSRF token is echoed from its
// readable cookie (specs/19 SEC-17). A 401 triggers one refresh, serialised across tabs (SEC-12).

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
  get offline() {
    return this.status === 0;
  }
}

const BASE = '/api/v1';

function csrfToken(): string | null {
  const m = document.cookie.match(/(?:^|;\s*)(?:__Host-)?wp_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]!) : null;
}

let refreshing: Promise<boolean> | null = null;

/** Single-flight refresh: one request per tab, and the Web Locks API serialises tabs. */
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    const run = async () => {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'x-csrf-token': csrfToken() ?? '' },
      });
      // 409 = another tab just refreshed; its new cookie is already in the jar.
      return res.ok || res.status === 409;
    };
    try {
      return navigator.locks ? await navigator.locks.request('wayflow-refresh', run) : await run();
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

export type SessionListener = () => void;
const expiredListeners = new Set<SessionListener>();
export const onSessionExpired = (l: SessionListener) => {
  expiredListeners.add(l);
  return () => {
    expiredListeners.delete(l);
  };
};

const MESSAGES: Record<string, string> = {
  unauthenticated: 'Sign in to continue.',
  session_expired: 'Your session has ended. Sign in again.',
  csrf_failed: 'Security check failed. Reload the page and try again.',
  rate_limited: 'Too many requests. Wait a moment and try again.',
  internal_error: 'Something went wrong on our side. Try again in a moment.',
};

export async function api<T>(path: string, init: { method?: string; body?: unknown; form?: FormData; retry?: boolean } = {}): Promise<T> {
  const method = init.method ?? (init.body !== undefined || init.form ? 'POST' : 'GET');
  const headers: Record<string, string> = {};
  if (method !== 'GET') headers['x-csrf-token'] = csrfToken() ?? '';
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      credentials: 'include',
      headers,
      body: init.form ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
    });
  } catch {
    throw new ApiError(0, 'offline', 'No connection. Check your signal and try again.');
  }
  if (res.status === 401 && init.retry !== false && !path.startsWith('/auth/')) {
    if (await refreshSession()) return api<T>(path, { ...init, retry: false });
    expiredListeners.forEach((l) => l());
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const code = (data?.code as string) ?? 'error';
    throw new ApiError(res.status, code, (data?.message as string) ?? MESSAGES[code] ?? 'Request failed.', data?.details);
  }
  return data as T;
}

export const get = <T,>(path: string) => api<T>(path);
export const post = <T,>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body });
export const put = <T,>(path: string, body: unknown = {}) => api<T>(path, { method: 'PUT', body });
export const del = <T,>(path: string) => api<T>(path, { method: 'DELETE' });

// Cookie-aware HTTP client for integration tests against a running stack.
export const BASE = process.env.API_URL ?? 'http://localhost:8080/api/v1';
export const ORIGIN = new URL(BASE).origin;
export const PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'Waypoint-Demo-2026!';

export interface Res<T = any> {
  status: number;
  data: T;
  headers: Headers;
  cookies: string[];
}

export class Client {
  jar = new Map<string, string>();

  private cookieHeader() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  csrf() {
    return this.jar.get('wp_csrf') ?? this.jar.get('__Host-wp_csrf') ?? '';
  }

  async req<T = any>(method: string, path: string, body?: unknown, opts: { headers?: Record<string, string>; csrf?: boolean; form?: FormData } = {}): Promise<Res<T>> {
    const headers: Record<string, string> = { origin: ORIGIN, ...opts.headers };
    if (this.jar.size) headers.cookie = this.cookieHeader();
    if (opts.csrf !== false && method !== 'GET') headers['x-csrf-token'] = this.csrf();
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(BASE + path, { method, headers, body: opts.form ?? (body === undefined ? undefined : JSON.stringify(body)), redirect: 'manual' });
    const cookies = res.headers.getSetCookie();
    for (const c of cookies) {
      const [kv] = c.split(';');
      const i = kv!.indexOf('=');
      const k = kv!.slice(0, i);
      const v = kv!.slice(i + 1);
      if (v) this.jar.set(k, v);
      else this.jar.delete(k);
    }
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: res.status, data: data as T, headers: res.headers, cookies };
  }

  get = <T = any>(p: string) => this.req<T>('GET', p);
  post = <T = any>(p: string, b: unknown = {}) => this.req<T>('POST', p, b);
  put = <T = any>(p: string, b: unknown = {}) => this.req<T>('PUT', p, b);

  static async login(email: string, password = PASSWORD) {
    const c = new Client();
    const r = await c.post('/auth/login', { email, password });
    if (r.status !== 200) throw new Error(`login ${email} -> ${r.status} ${JSON.stringify(r.data)}`);
    return c;
  }
}

export const act = (action: Record<string, unknown>) => ({ clientActionId: crypto.randomUUID(), createdAtClient: new Date().toISOString(), action });

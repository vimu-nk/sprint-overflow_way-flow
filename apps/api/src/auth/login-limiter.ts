import { Inject, Injectable } from '@nestjs/common';
import type { Valkey } from 'iovalkey';
import { VALKEY } from '../valkey/valkey.module.js';

const WINDOW_SEC = 15 * 60;
const FREE_ATTEMPTS = 5;

/**
 * Login throttling per IP and per account (SEC-50): after 5 failures inside 15 minutes each
 * further attempt waits exponentially longer (30 s, 60 s, … capped at 15 min). It is a
 * temporary delay, not a permanent lock, so attackers cannot lock real users out for long.
 */
@Injectable()
export class LoginLimiter {
  constructor(@Inject(VALKEY) private readonly valkey: Valkey) {}

  private keys(ip: string, email: string) {
    return [`login:ip:${ip}`, `login:acct:${email}`];
  }

  /** Seconds the caller must wait, or 0. */
  async retryAfter(ip: string, email: string): Promise<number> {
    let wait = 0;
    for (const k of this.keys(ip, email)) {
      const [count, last] = await Promise.all([this.valkey.get(`${k}:n`), this.valkey.get(`${k}:t`)]);
      const n = Number(count ?? 0);
      if (n < FREE_ATTEMPTS) continue;
      const delay = Math.min(WINDOW_SEC, 30 * 2 ** (n - FREE_ATTEMPTS));
      const until = Number(last ?? 0) + delay * 1000;
      wait = Math.max(wait, Math.ceil((until - Date.now()) / 1000));
    }
    return Math.max(0, wait);
  }

  async fail(ip: string, email: string): Promise<void> {
    const multi = this.valkey.multi();
    for (const k of this.keys(ip, email)) {
      multi.incr(`${k}:n`).expire(`${k}:n`, WINDOW_SEC).set(`${k}:t`, String(Date.now()), 'EX', WINDOW_SEC);
    }
    await multi.exec();
  }

  async succeed(ip: string, email: string): Promise<void> {
    await this.valkey.del(`login:acct:${email}:n`, `login:acct:${email}:t`);
    void ip;
  }

  /** Count failed logins in the last 5 minutes for the alert threshold (SEC-68). */
  async noteFailureForAlert(): Promise<number> {
    const k = `login:fail5m:${Math.floor(Date.now() / 300_000)}`;
    const n = await this.valkey.incr(k);
    await this.valkey.expire(k, 600);
    return n;
  }
}

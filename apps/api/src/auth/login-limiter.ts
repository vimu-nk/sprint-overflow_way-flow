import { Inject, Injectable } from '@nestjs/common';
import type { Valkey } from 'iovalkey';
import { VALKEY } from '../valkey/valkey.module.js';

const WINDOW_SEC = 15 * 60;
/** Failures allowed per (IP, account) pair, and per IP across all accounts (credential stuffing). */
const FREE_PAIR = 5;
const FREE_IP = 50;

/**
 * Login throttling per IP + account (SEC-50): after 5 failures for the same account from the same
 * IP inside 15 minutes, each further attempt waits exponentially longer (30 s, 60 s, … capped at
 * 15 min). An IP-wide ceiling of 50 failures slows credential stuffing across accounts. It is a
 * temporary delay, not a permanent lock, so one user's typos never lock out a shared IP.
 */
@Injectable()
export class LoginLimiter {
  constructor(@Inject(VALKEY) private readonly valkey: Valkey) {}

  private keys(ip: string, email: string): [string, number][] {
    return [
      [`login:pair:${ip}:${email}`, FREE_PAIR],
      [`login:ip:${ip}`, FREE_IP],
    ];
  }

  /** Seconds the caller must wait, or 0. */
  async retryAfter(ip: string, email: string): Promise<number> {
    let wait = 0;
    for (const [k, free] of this.keys(ip, email)) {
      const [count, last] = await Promise.all([this.valkey.get(`${k}:n`), this.valkey.get(`${k}:t`)]);
      const n = Number(count ?? 0);
      if (n < free) continue;
      const delay = Math.min(WINDOW_SEC, 30 * 2 ** (n - free));
      const until = Number(last ?? 0) + delay * 1000;
      wait = Math.max(wait, Math.ceil((until - Date.now()) / 1000));
    }
    return Math.max(0, wait);
  }

  async fail(ip: string, email: string): Promise<void> {
    const multi = this.valkey.multi();
    for (const [k] of this.keys(ip, email)) {
      multi.incr(`${k}:n`).expire(`${k}:n`, WINDOW_SEC).set(`${k}:t`, String(Date.now()), 'EX', WINDOW_SEC);
    }
    await multi.exec();
  }

  async succeed(ip: string, email: string): Promise<void> {
    await this.valkey.del(`login:pair:${ip}:${email}:n`, `login:pair:${ip}:${email}:t`);
  }

  /** Count failed logins in the last 5 minutes for the alert threshold (SEC-68). */
  async noteFailureForAlert(): Promise<number> {
    const k = `login:fail5m:${Math.floor(Date.now() / 300_000)}`;
    const n = await this.valkey.incr(k);
    await this.valkey.expire(k, 600);
    return n;
  }
}

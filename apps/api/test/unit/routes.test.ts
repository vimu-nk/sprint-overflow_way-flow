import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it } from 'vitest';
import { IS_PUBLIC, ROLES_KEY } from '../../src/common/decorators.js';

/**
 * SEC-25: every route is authenticated unless it is on this explicit allow-list, and every
 * role-specific controller declares its roles. Fails when someone adds an unguarded route.
 */
const PUBLIC_ALLOWED = new Set(['POST auth/login', 'POST auth/refresh', 'POST auth/logout', 'GET health', 'GET ready']);
const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD'];

async function controllers() {
  const mods = await Promise.all([
    import('../../src/auth/auth.controller.js'),
    import('../../src/health/health.controller.js'),
    import('../../src/clock/clock.controller.js'),
    import('../../src/store/store.controller.js'),
    import('../../src/dispatcher/dispatcher.controller.js'),
    import('../../src/field/field.controller.js'),
    import('../../src/attachments/attachments.controller.js'),
    import('../../src/notifications/notifications.controller.js'),
    import('../../src/dev/dev.controller.js'),
  ]);
  return mods.flatMap((m) => Object.values(m).filter((v): v is new (...a: never[]) => object => typeof v === 'function' && Reflect.hasMetadata(PATH_METADATA, v)));
}

describe('route authorization table', () => {
  it('only the allow-listed routes are public', async () => {
    const found: string[] = [];
    for (const c of await controllers()) {
      const base = Reflect.getMetadata(PATH_METADATA, c) as string;
      const classPublic = Reflect.getMetadata(IS_PUBLIC, c) === true;
      for (const name of Object.getOwnPropertyNames(c.prototype).filter((n) => n !== 'constructor')) {
        const fn = (c.prototype as Record<string, unknown>)[name];
        if (typeof fn !== 'function' || !Reflect.hasMetadata(PATH_METADATA, fn)) continue;
        const method = METHODS[Reflect.getMetadata(METHOD_METADATA, fn) as number]!;
        const path = [base, Reflect.getMetadata(PATH_METADATA, fn) as string].filter((p) => p && p !== '/').join('/');
        if (classPublic || Reflect.getMetadata(IS_PUBLIC, fn) === true) found.push(`${method} ${path}`);
      }
    }
    expect(new Set(found)).toEqual(PUBLIC_ALLOWED);
  });

  it('role-scoped controllers declare their roles', async () => {
    const expected: Record<string, string[]> = {
      dispatcher: ['dispatcher'],
      store: ['store_manager'],
      loader: ['loader'],
      driver: ['driver'],
      sync: ['loader', 'driver'],
      dev: ['dispatcher'],
    };
    for (const c of await controllers()) {
      const base = Reflect.getMetadata(PATH_METADATA, c) as string;
      if (expected[base]) expect(Reflect.getMetadata(ROLES_KEY, c)).toEqual(expected[base]);
    }
  });
});

import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { CronSecretGuard } from './cron-secret.guard.js';

function createContext(authorization?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization } }) as Request,
    }),
  } as unknown as ExecutionContext;
}

describe('CronSecretGuard', () => {
  const configuredSecret = 'test-cron-secret';
  const guard = new CronSecretGuard(new ConfigService({ CRON_SECRET: configuredSecret }));

  it('accepts the Vercel Cron bearer token', () => {
    expect(guard.canActivate(createContext(`Bearer ${configuredSecret}`))).toBe(true);
  });

  it.each([undefined, 'Bearer wrong-secret', configuredSecret])(
    'rejects a missing or invalid authorization header',
    (authorization) => {
      expect(() => guard.canActivate(createContext(authorization))).toThrow(UnauthorizedException);
    },
  );

  it('fails closed when CRON_SECRET is not configured', () => {
    const unconfiguredGuard = new CronSecretGuard(new ConfigService({}));

    expect(() =>
      unconfiguredGuard.canActivate(createContext(`Bearer ${configuredSecret}`)),
    ).toThrow(UnauthorizedException);
  });
});

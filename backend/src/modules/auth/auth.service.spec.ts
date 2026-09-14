import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AuthService } from './auth.service.js';
import { hashPassword } from './password-hasher.js';

function createFixture(passwordHash: string) {
  const user = {
    id: 'bb8bf7d2-e17c-44da-b456-b7240d30daf2',
    email: 'tatuador@example.com',
    passwordHash,
  };
  const findUnique = vi.fn().mockResolvedValue(user);
  const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
  const create = vi.fn(
    (arguments_: { data: { userId: string; tokenHash: string; expiresAt: Date } }) => {
      void arguments_;
      return Promise.resolve({ id: 'session-id' });
    },
  );
  const runTransaction = vi.fn((operations: Promise<unknown>[]) => Promise.all(operations));
  const prisma = {
    user: { findUnique },
    authSession: { deleteMany, create },
    $transaction: runTransaction,
  } as unknown as PrismaService;
  const service = new AuthService(
    prisma,
    new ConfigService({ NODE_ENV: 'test', SESSION_TTL_HOURS: 168 }),
  );

  return { service, create };
}

describe('AuthService login', () => {
  it('creates an opaque database session for correct credentials', async () => {
    const passwordHash = await hashPassword('Una-clave-segura-123');
    const fixture = createFixture(passwordHash);

    const result = await fixture.service.login('  TATUADOR@example.com ', 'Una-clave-segura-123');

    expect(result.user).toEqual({
      id: 'bb8bf7d2-e17c-44da-b456-b7240d30daf2',
      email: 'tatuador@example.com',
    });
    expect(result).not.toHaveProperty('passwordHash');
    const createdData = fixture.create.mock.calls[0]?.[0].data;
    expect(createdData?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(createdData?.tokenHash).not.toBe(result.sessionToken);
  });

  it('rejects an incorrect password with a generic response', async () => {
    const passwordHash = await hashPassword('Una-clave-segura-123');
    const fixture = createFixture(passwordHash);

    await expect(fixture.service.login('tatuador@example.com', 'clave-incorrecta')).rejects.toEqual(
      new UnauthorizedException('Correo o contraseña incorrectos.'),
    );
    expect(fixture.create).not.toHaveBeenCalled();
  });
});

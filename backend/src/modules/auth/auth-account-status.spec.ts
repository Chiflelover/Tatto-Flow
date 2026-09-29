import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AuthService } from './auth.service.js';
import { hashPassword } from './password-hasher.js';

describe('AuthService disabled artist account', () => {
  it('blocks new logins and existing sessions after the account is disabled', async () => {
    const passwordHash = await hashPassword('Una-clave-segura-123');
    const user = {
      id: 'artist-user',
      email: 'artist@example.com',
      passwordHash,
      role: UserRole.TATTOO_ARTIST,
      accountId: '00000000-0000-4000-8000-000000000002',
      account: { isActive: false },
    };
    const create = vi.fn();
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const service = new AuthService(
      {
        user: { findUnique: vi.fn().mockResolvedValue(user) },
        authSession: {
          create,
          deleteMany,
          findUnique: vi.fn().mockResolvedValue({
            expiresAt: new Date(Date.now() + 60_000),
            user,
          }),
        },
      } as unknown as PrismaService,
      new ConfigService({ NODE_ENV: 'test' }),
    );

    await expect(service.login(user.email, 'Una-clave-segura-123')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(service.authenticateSession('existing-session')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(create).not.toHaveBeenCalled();
    expect(deleteMany).toHaveBeenCalledOnce();
  });
});

import type { Response } from 'express';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

describe('AuthController response safety', () => {
  it('returns only the public user projection after login', async () => {
    const login = vi.fn().mockResolvedValue({
      sessionToken: 'opaque-session-token',
      expiresAt: new Date('2026-09-21T12:00:00.000Z'),
      user: {
        id: 'bb8bf7d2-e17c-44da-b456-b7240d30daf2',
        email: 'tatuador@example.com',
      },
    });
    const cookie = vi.fn();
    const controller = new AuthController({
      login,
      sessionCookieOptions: vi.fn().mockReturnValue({ httpOnly: true }),
    } as unknown as AuthService);

    const result = await controller.login(
      { email: 'tatuador@example.com', password: 'clave-segura' },
      { cookie } as unknown as Response,
    );

    expect(result).toEqual({
      user: {
        id: 'bb8bf7d2-e17c-44da-b456-b7240d30daf2',
        email: 'tatuador@example.com',
      },
    });
    expect(result).not.toHaveProperty('passwordHash');
    expect(result).not.toHaveProperty('sessionToken');
    expect(cookie).toHaveBeenCalledOnce();
  });
});

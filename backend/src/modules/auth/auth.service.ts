import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import type { CookieOptions } from 'express';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { DEFAULT_SESSION_TTL_HOURS } from './auth.constants.js';
import type { AuthenticatedTattooArtist } from './auth.types.js';
import { verifyPassword } from './password-hasher.js';

interface LoginResult {
  sessionToken: string;
  expiresAt: Date;
  user: AuthenticatedTattooArtist;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async login(email: string, password: string): Promise<LoginResult> {
    const normalizedEmail = email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, email: true, passwordHash: true },
    });
    const passwordMatches = user
      ? await verifyPassword(password, user.passwordHash)
      : await this.performDummyPasswordCheck(password);

    if (!user || !passwordMatches) {
      throw new UnauthorizedException('Correo o contraseña incorrectos.');
    }

    const sessionToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.sessionTtlMilliseconds());

    await this.prisma.$transaction([
      this.prisma.authSession.deleteMany({
        where: { expiresAt: { lte: new Date() } },
      }),
      this.prisma.authSession.create({
        data: {
          userId: user.id,
          tokenHash: this.hashSessionToken(sessionToken),
          expiresAt,
        },
      }),
    ]);

    return {
      sessionToken,
      expiresAt,
      user: { id: user.id, email: user.email },
    };
  }

  async authenticateSession(sessionToken: string): Promise<AuthenticatedTattooArtist> {
    const session = await this.prisma.authSession.findUnique({
      where: { tokenHash: this.hashSessionToken(sessionToken) },
      select: {
        expiresAt: true,
        user: { select: { id: true, email: true } },
      },
    });

    if (!session || session.expiresAt <= new Date()) {
      if (session) {
        await this.prisma.authSession.deleteMany({
          where: { tokenHash: this.hashSessionToken(sessionToken) },
        });
      }

      throw new UnauthorizedException('La sesión no es válida o ha expirado.');
    }

    return session.user;
  }

  async logout(sessionToken: string): Promise<void> {
    await this.prisma.authSession.deleteMany({
      where: { tokenHash: this.hashSessionToken(sessionToken) },
    });
  }

  sessionCookieOptions(expiresAt?: Date): CookieOptions {
    return {
      httpOnly: true,
      secure: this.configService.get<string>('NODE_ENV') === 'production',
      sameSite: 'lax',
      path: '/',
      ...(expiresAt ? { expires: expiresAt } : {}),
    };
  }

  private hashSessionToken(sessionToken: string): string {
    return createHash('sha256').update(sessionToken).digest('hex');
  }

  private sessionTtlMilliseconds(): number {
    const hours = this.configService.get<number>('SESSION_TTL_HOURS', DEFAULT_SESSION_TTL_HOURS);

    return hours * 60 * 60 * 1_000;
  }

  private async performDummyPasswordCheck(password: string): Promise<boolean> {
    const dummyHash = 'scrypt$16384$8$1$00000000000000000000000000000000$' + '00'.repeat(64);

    await verifyPassword(password, dummyHash);
    return false;
  }
}

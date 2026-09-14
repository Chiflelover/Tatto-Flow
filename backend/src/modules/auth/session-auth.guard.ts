import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { SESSION_COOKIE_NAME } from './auth.constants.js';
import { AuthService } from './auth.service.js';
import type { AuthenticatedRequest } from './auth.types.js';

export function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) {
    return null;
  }

  for (const cookie of cookieHeader.split(';')) {
    const separator = cookie.indexOf('=');

    if (separator < 0 || cookie.slice(0, separator).trim() !== name) {
      continue;
    }

    return cookie.slice(separator + 1).trim() || null;
  }

  return null;
}

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const sessionToken = readCookie(request.headers.cookie, SESSION_COOKIE_NAME);

    if (!sessionToken) {
      throw new UnauthorizedException('Debes iniciar sesión para continuar.');
    }

    request.tattooArtist = await this.authService.authenticateSession(sessionToken);
    request.sessionToken = sessionToken;

    return true;
  }
}

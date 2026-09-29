import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole } from '../../generated/prisma/client.js';
import type { AuthenticatedRequest } from './auth.types.js';

@Injectable()
export class TattooArtistGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().tattooArtist;
    if (user.role !== UserRole.TATTOO_ARTIST || !user.accountId) {
      throw new ForbiddenException('Esta sección es solo para tatuadores.');
    }
    return true;
  }
}

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().tattooArtist;
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Esta sección es solo para administración.');
    }
    return true;
  }
}

import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

@Injectable()
export class CronSecretGuard implements CanActivate {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const configuredSecret = this.config.get<string>('CRON_SECRET')?.trim();
    const authorization = context.switchToHttp().getRequest<Request>().headers.authorization;
    const suppliedSecret = this.readBearerToken(authorization);

    if (
      !configuredSecret ||
      !suppliedSecret ||
      !this.secureTextEquals(suppliedSecret, configuredSecret)
    ) {
      throw new UnauthorizedException('No fue posible autorizar la tarea programada.');
    }

    return true;
  }

  private readBearerToken(authorization: string | undefined): string | null {
    const match = /^Bearer (.+)$/i.exec(authorization ?? '');

    return match?.[1]?.trim() || null;
  }

  private secureTextEquals(left: string, right: string): boolean {
    const leftHash = createHash('sha256').update(left).digest();
    const rightHash = createHash('sha256').update(right).digest();

    return timingSafeEqual(leftHash, rightHash);
  }
}

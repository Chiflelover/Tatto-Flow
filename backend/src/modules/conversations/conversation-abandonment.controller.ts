import {
  Controller,
  Get,
  Header,
  Headers,
  Inject,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { ConversationAbandonmentService } from './conversation-abandonment.service.js';

@Controller('conversations')
export class ConversationAbandonmentController {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(ConversationAbandonmentService)
    private readonly abandonment: ConversationAbandonmentService,
  ) {}

  @Get('abandon-inactive')
  @Header('Cache-Control', 'no-store')
  async abandon(@Headers('authorization') authorization: string | undefined) {
    const secret = this.config.get<string>('CRON_SECRET')?.trim();
    if (!secret || secret.length < 32)
      throw new ServiceUnavailableException('El barrido de conversaciones no está configurado.');
    const expected = Buffer.from(`Bearer ${secret}`);
    const supplied = Buffer.from(authorization ?? '');
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
      throw new UnauthorizedException();

    return { abandonedCount: await this.abandonment.abandonInactive() };
  }
}

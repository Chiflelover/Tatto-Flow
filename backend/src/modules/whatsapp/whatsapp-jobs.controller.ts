import {
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { WhatsAppJobProcessor } from './whatsapp-job-processor.service.js';

@Controller('whatsapp/jobs')
export class WhatsAppJobsController {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(WhatsAppJobProcessor) private readonly processor: WhatsAppJobProcessor,
  ) {}
  @Get('process')
  @Header('Cache-Control', 'no-store')
  process(@Headers('authorization') authorization: string | undefined) {
    const secret = this.config.get<string>('CRON_SECRET')?.trim();
    if (!secret || secret.length < 32)
      throw new ServiceUnavailableException('La recuperación de trabajos no está configurada.');
    const expected = Buffer.from(`Bearer ${secret}`),
      supplied = Buffer.from(authorization ?? '');
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
      throw new UnauthorizedException();
    return this.processor.runNext();
  }
  @Post('process')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  processPost(@Headers('authorization') authorization: string | undefined) {
    return this.process(authorization);
  }
}

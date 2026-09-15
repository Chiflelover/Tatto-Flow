import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import { WhatsAppWebhookService } from './whatsapp-webhook.service.js';

@Controller('whatsapp')
export class WhatsAppController {
  constructor(@Inject(WhatsAppWebhookService) private readonly webhook: WhatsAppWebhookService) {}

  @Get('webhook')
  @Header('Content-Type', 'text/plain')
  verifyWebhook(
    @Query('hub.mode') mode: unknown,
    @Query('hub.verify_token') verifyToken: unknown,
    @Query('hub.challenge') challenge: unknown,
  ): string {
    return this.webhook.verifyChallenge(mode, verifyToken, challenge);
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  receiveWebhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string | undefined,
  ): Promise<{ received: true }> {
    if (!request.rawBody) {
      throw new BadRequestException('No fue posible validar el cuerpo del webhook de WhatsApp.');
    }

    return this.webhook.handleWebhook(request.rawBody, signature);
  }
}

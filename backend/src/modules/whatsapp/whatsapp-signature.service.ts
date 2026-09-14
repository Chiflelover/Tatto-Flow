import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { getRequiredWhatsAppValue } from './whatsapp.config.js';

@Injectable()
export class WhatsAppSignatureService {
  constructor(private readonly config: ConfigService) {}

  verifyChallenge(mode: unknown, verifyToken: unknown, challenge: unknown): string {
    if (
      mode !== 'subscribe' ||
      typeof verifyToken !== 'string' ||
      !this.secureTextEquals(
        verifyToken,
        getRequiredWhatsAppValue(this.config, 'WHATSAPP_VERIFY_TOKEN'),
      )
    ) {
      throw new UnauthorizedException('No fue posible verificar el webhook de WhatsApp.');
    }

    if (typeof challenge !== 'string' || !challenge) {
      throw new BadRequestException('Meta no envió un desafío válido.');
    }

    return challenge;
  }

  assertValidPayload(rawBody: Buffer, signature: string | undefined): void {
    if (!signature || !/^sha256=[a-f\d]{64}$/i.test(signature)) {
      throw new UnauthorizedException('La firma del webhook de WhatsApp no es válida.');
    }

    const supplied = Buffer.from(signature.slice('sha256='.length), 'hex');
    const expected = createHmac(
      'sha256',
      getRequiredWhatsAppValue(this.config, 'META_APP_SECRET'),
    )
      .update(rawBody)
      .digest();

    if (!timingSafeEqual(supplied, expected)) {
      throw new UnauthorizedException('La firma del webhook de WhatsApp no es válida.');
    }
  }

  private secureTextEquals(left: string, right: string): boolean {
    const leftHash = createHash('sha256').update(left).digest();
    const rightHash = createHash('sha256').update(right).digest();

    return timingSafeEqual(leftHash, rightHash);
  }
}

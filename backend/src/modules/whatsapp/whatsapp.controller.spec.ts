import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { WhatsAppController } from './whatsapp.controller.js';
import { WhatsAppWebhookService } from './whatsapp-webhook.service.js';

describe('WhatsAppController', () => {
  it('returns the exact challenge received during Meta verification', () => {
    const verifyChallenge = vi.fn().mockReturnValue('challenge-123');
    const controller = new WhatsAppController({
      verifyChallenge,
    } as unknown as WhatsAppWebhookService);

    expect(controller.verifyWebhook('subscribe', 'verify-token', 'challenge-123')).toBe(
      'challenge-123',
    );
    expect(verifyChallenge).toHaveBeenCalledWith('subscribe', 'verify-token', 'challenge-123');
  });

  it('passes the untouched raw body and signature to webhook processing', async () => {
    const rawBody = Buffer.from('{"object":"whatsapp_business_account"}');
    const handleWebhook = vi.fn().mockResolvedValue({ received: true });
    const controller = new WhatsAppController({
      handleWebhook,
    } as unknown as WhatsAppWebhookService);

    await expect(
      controller.receiveWebhook({ rawBody } as RawBodyRequest<Request>, `sha256=${'a'.repeat(64)}`),
    ).resolves.toEqual({ received: true });
    expect(handleWebhook).toHaveBeenCalledWith(rawBody, `sha256=${'a'.repeat(64)}`);
  });
});

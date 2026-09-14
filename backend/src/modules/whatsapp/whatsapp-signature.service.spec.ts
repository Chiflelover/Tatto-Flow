import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'node:crypto';
import { WhatsAppSignatureService } from './whatsapp-signature.service.js';

const META_APP_SECRET = 'test-app-secret';
const VERIFY_TOKEN = 'test-verify-token';

function createService() {
  return new WhatsAppSignatureService(
    new ConfigService({
      META_APP_SECRET,
      WHATSAPP_VERIFY_TOKEN: VERIFY_TOKEN,
    }),
  );
}

describe('WhatsAppSignatureService', () => {
  it('returns Meta hub.challenge only for the configured verification token', () => {
    expect(createService().verifyChallenge('subscribe', VERIFY_TOKEN, 'challenge-123')).toBe(
      'challenge-123',
    );
  });

  it.each([
    ['wrong mode', 'unsubscribe', VERIFY_TOKEN],
    ['wrong token', 'subscribe', 'wrong-token'],
  ])('rejects webhook verification with %s', (_case, mode, token) => {
    expect(() => createService().verifyChallenge(mode, token, 'challenge-123')).toThrow(
      UnauthorizedException,
    );
  });

  it('accepts an X-Hub-Signature-256 generated from the exact raw body', () => {
    const rawBody = Buffer.from('{"object":"whatsapp_business_account"}');
    const signature = `sha256=${createHmac('sha256', META_APP_SECRET).update(rawBody).digest('hex')}`;

    expect(() => createService().assertValidPayload(rawBody, signature)).not.toThrow();
  });

  it.each([undefined, 'sha256=invalid', `sha256=${'0'.repeat(64)}`])(
    'rejects an invalid webhook signature: %s',
    (signature) => {
      expect(() =>
        createService().assertValidPayload(Buffer.from('{"valid":true}'), signature),
      ).toThrow(UnauthorizedException);
    },
  );
});

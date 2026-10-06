import { ConfigService } from '@nestjs/config';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { SafeStructuredLogger } from '../../infrastructure/observability/safe-structured-logger.js';
import { WhatsAppSignatureService } from './whatsapp-signature.service.js';
import { WhatsAppWebhookService } from './whatsapp-webhook.service.js';
import { WhatsAppChannelService } from './whatsapp-channel.service.js';
import { WhatsAppJobRepository } from './whatsapp-job.repository.js';
import { WhatsAppJobDispatcher } from './whatsapp-job-dispatcher.service.js';

const BUSINESS_ACCOUNT_ID = '1111111111';
const PHONE_NUMBER_ID = '2222222222';
const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';
const CUSTOMER = '51999999999';
const MESSAGE_ID = 'wamid.inbound-1';

function payload(message: object, overrides: { accountId?: string; phoneId?: string } = {}) {
  return Buffer.from(
    JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: overrides.accountId ?? BUSINESS_ACCOUNT_ID,
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: overrides.phoneId ?? PHONE_NUMBER_ID },
                messages: [message],
              },
            },
          ],
        },
      ],
    }),
  );
}

function createFixture() {
  const assertValidPayload = vi.fn();
  const resolve = vi
    .fn()
    .mockImplementation((id: string) =>
      Promise.resolve(
        id === PHONE_NUMBER_ID ? { accountId: ACCOUNT_ID, phoneNumberId: PHONE_NUMBER_ID } : null,
      ),
    );
  const enqueue = vi.fn().mockResolvedValue({ queued: true, customerId: 'customer-id' });
  const wake = vi.fn();
  const service = new WhatsAppWebhookService(
    new ConfigService({
      WHATSAPP_BUSINESS_ACCOUNT_ID: BUSINESS_ACCOUNT_ID,
      WHATSAPP_PHONE_NUMBER_ID: PHONE_NUMBER_ID,
    }),
    { assertValidPayload } as unknown as WhatsAppSignatureService,
    { resolve } as unknown as WhatsAppChannelService,
    { enqueue } as unknown as WhatsAppJobRepository,
    { wake } as unknown as WhatsAppJobDispatcher,
  );

  return {
    service,
    assertValidPayload,
    resolve,
    enqueue,
    wake,
  };
}

function observeServiceLogs(service: WhatsAppWebhookService) {
  return vi.spyOn(Reflect.get(service, 'logger') as SafeStructuredLogger, 'info');
}

describe('WhatsAppWebhookService', () => {
  it.each<[object, object]>([
    [
      { type: 'text', text: { body: 'Hola' } },
      { type: 'text', text: 'Hola' },
    ],
    [
      {
        type: 'interactive',
        interactive: { type: 'button_reply', button_reply: { id: 'nita_same_size_yes' } },
      },
      { type: 'button_reply', buttonId: 'nita_same_size_yes' },
    ],
    [
      {
        type: 'interactive',
        interactive: { type: 'list_reply', list_reply: { id: 'nita_color_black_only' } },
      },
      { type: 'button_reply', buttonId: 'nita_color_black_only' },
    ],
    ...['nita_color_low', 'nita_color_medium', 'nita_color_full'].map((id): [object, object] => [
      { type: 'interactive', interactive: { type: 'list_reply', list_reply: { id } } },
      { type: 'button_reply', buttonId: id },
    ]),
  ])(
    'validates signatures and enqueues supported input %# for the receiving account',
    async (message, input) => {
      const f = createFixture();
      const body = payload({ id: MESSAGE_ID, from: CUSTOMER, ...message });
      await f.service.handleWebhook(body, 'signature');
      expect(f.assertValidPayload).toHaveBeenCalledWith(body, 'signature');
      expect(f.enqueue).toHaveBeenCalledWith(
        MESSAGE_ID,
        expect.objectContaining({ accountId: ACCOUNT_ID, phoneNumberId: PHONE_NUMBER_ID }),
        CUSTOMER,
        input,
      );
      expect(f.wake).toHaveBeenCalledOnce();
    },
  );

  it('rejects an invalid signature before enqueueing', async () => {
    const f = createFixture();
    f.assertValidPayload.mockImplementation(() => {
      throw new UnauthorizedException();
    });
    await expect(
      f.service.handleWebhook(payload({ id: MESSAGE_ID, from: CUSTOMER }), 'bad'),
    ).rejects.toThrow(UnauthorizedException);
    expect(f.enqueue).not.toHaveBeenCalled();
  });

  it.each([
    { type: 'text', text: { body: '' } },
    { type: 'text', text: { body: 'x'.repeat(1001) } },
    { type: 'image', image: { id: '' } },
    { from: 'invalid', type: 'text', text: { body: 'Hola' } },
  ])('rejects invalid incoming input %# without queueing', async (message) => {
    const f = createFixture();
    await expect(
      f.service.handleWebhook(payload({ id: MESSAGE_ID, from: CUSTOMER, ...message }), 'signature'),
    ).rejects.toThrow(BadRequestException);
    expect(f.enqueue).not.toHaveBeenCalled();
  });

  it('propagates persistence errors before acknowledging and waking a worker', async () => {
    const f = createFixture();
    f.enqueue.mockRejectedValue(new Error('Database unavailable'));
    await expect(
      f.service.handleWebhook(
        payload({ id: MESSAGE_ID, from: CUSTOMER, type: 'text', text: { body: 'Hola' } }),
        'signature',
      ),
    ).rejects.toThrow('Database unavailable');
    expect(f.wake).not.toHaveBeenCalled();
  });
  it('ACKs a persisted V2 image event without download, conversation processing or send', async () => {
    const f = createFixture();
    f.enqueue.mockResolvedValue({ queued: true, customerId: 'customer-id' });
    await expect(
      f.service.handleWebhook(
        payload({ id: MESSAGE_ID, from: CUSTOMER, type: 'image', image: { id: 'media-id' } }),
        'signature',
      ),
    ).resolves.toEqual({ received: true });
    expect(f.enqueue).toHaveBeenCalledWith(
      MESSAGE_ID,
      expect.objectContaining({ accountId: ACCOUNT_ID }),
      CUSTOMER,
      { type: 'image', mediaId: 'media-id' },
    );
    expect(f.wake).toHaveBeenCalledWith(ACCOUNT_ID, 'customer-id');
  });

  it.each([
    [
      'another business account',
      { accountId: '9999999999' },
      'business_account_id_mismatch',
      'entry.id',
      false,
    ],
    [
      'another phone number',
      { phoneId: '9999999999' },
      'phone_number_id_mismatch',
      'change.value.metadata.phone_number_id',
      true,
    ],
  ])(
    'logs why it ignores events addressed to %s without exposing either ID',
    async (_case, overrides, reason, field, hasMessages) => {
      const fixture = createFixture();
      const info = observeServiceLogs(fixture.service);

      await fixture.service.handleWebhook(
        payload(
          { id: MESSAGE_ID, from: CUSTOMER, type: 'text', text: { body: 'Hola' } },
          overrides,
        ),
        'sha256=valid',
      );

      expect(info).toHaveBeenCalledWith('whatsapp.webhook.ignored', {
        reason,
        object: 'whatsapp_business_account',
        field,
        hasMessages,
        hasStatuses: false,
      });
      expect(info.mock.calls.flat()).not.toContain('9999999999');
    },
  );

  it('distinguishes a delivery status webhook from an inbound message', async () => {
    const fixture = createFixture();
    const info = observeServiceLogs(fixture.service);
    const rawBody = Buffer.from(
      JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [
          {
            id: BUSINESS_ACCOUNT_ID,
            changes: [
              {
                field: 'messages',
                value: {
                  metadata: { phone_number_id: PHONE_NUMBER_ID },
                  statuses: [{ id: 'status-id' }],
                },
              },
            ],
          },
        ],
      }),
    );

    await fixture.service.handleWebhook(rawBody, 'sha256=valid');

    expect(info).toHaveBeenCalledWith('whatsapp.webhook.ignored', {
      reason: 'statuses_without_messages',
      object: 'whatsapp_business_account',
      field: 'change.value.messages',
      hasMessages: false,
      hasStatuses: true,
    });
  });
});

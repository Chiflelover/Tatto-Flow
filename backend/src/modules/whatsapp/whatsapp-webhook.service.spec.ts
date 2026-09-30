import { ConfigService } from '@nestjs/config';
import { SafeStructuredLogger } from '../../infrastructure/observability/safe-structured-logger.js';
import { WhatsAppAdapter, WHATSAPP_BUTTON_IDS } from '../chatbot/whatsapp/whatsapp.adapter.js';
import { WhatsAppCloudApiClient } from './whatsapp-cloud-api.client.js';
import { WhatsAppInboundMessageRepository } from './whatsapp-inbound-message.repository.js';
import { WhatsAppSignatureService } from './whatsapp-signature.service.js';
import { WhatsAppWebhookService } from './whatsapp-webhook.service.js';
import { WhatsAppChannelService } from './whatsapp-channel.service.js';

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
  const claim = vi.fn().mockResolvedValue(true);
  const release = vi.fn().mockResolvedValue(undefined);
  const handleIncoming = vi.fn().mockResolvedValue([{ type: 'text', text: 'Respuesta de Nita' }]);
  const resumePendingV2Analysis = vi.fn().mockResolvedValue(undefined);
  const sendMessage = vi.fn().mockResolvedValue(undefined);
  const downloadImage = vi.fn().mockResolvedValue({
    content: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    mimeType: 'image/png',
    fileName: 'whatsapp-reference.png',
  });
  const resolve = vi
    .fn()
    .mockImplementation((id: string) =>
      Promise.resolve(
        id === PHONE_NUMBER_ID ? { accountId: ACCOUNT_ID, phoneNumberId: PHONE_NUMBER_ID } : null,
      ),
    );
  const service = new WhatsAppWebhookService(
    new ConfigService({
      WHATSAPP_BUSINESS_ACCOUNT_ID: BUSINESS_ACCOUNT_ID,
      WHATSAPP_PHONE_NUMBER_ID: PHONE_NUMBER_ID,
    }),
    { assertValidPayload } as unknown as WhatsAppSignatureService,
    { claim, release } as unknown as WhatsAppInboundMessageRepository,
    { handleIncoming, resumePendingV2Analysis } as unknown as WhatsAppAdapter,
    { sendMessage, downloadImage } as unknown as WhatsAppCloudApiClient,
    { resolve } as unknown as WhatsAppChannelService,
  );

  return {
    service,
    assertValidPayload,
    claim,
    release,
    handleIncoming,
    resumePendingV2Analysis,
    sendMessage,
    downloadImage,
    resolve,
  };
}

function observeServiceLogs(service: WhatsAppWebhookService) {
  return vi.spyOn(Reflect.get(service, 'logger') as SafeStructuredLogger, 'info');
}

describe('WhatsAppWebhookService', () => {
  it('resumes only pending V2 work on duplicate delivery without replaying the message', async () => {
    const f = createFixture();
    f.claim.mockResolvedValue(false);
    await f.service.handleWebhook(
      payload({
        id: MESSAGE_ID,
        from: CUSTOMER,
        type: 'text',
        text: { body: 'Respuesta anterior' },
      }),
      'sha256=valid',
    );
    expect(f.resumePendingV2Analysis).toHaveBeenCalledWith(ACCOUNT_ID, CUSTOMER);
    expect(f.handleIncoming).not.toHaveBeenCalled();
    expect(f.sendMessage).not.toHaveBeenCalled();
  });
  it('keeps a duplicate retryable if its V2 claim is still busy or recovery fails', async () => {
    const f = createFixture();
    f.claim.mockResolvedValue(false);
    f.resumePendingV2Analysis.mockRejectedValue(new Error('Retry recovery'));
    await expect(
      f.service.handleWebhook(
        payload({ id: MESSAGE_ID, from: CUSTOMER, type: 'text', text: { body: 'Anterior' } }),
        'sha256=valid',
      ),
    ).rejects.toThrow('Retry recovery');
    expect(f.release).not.toHaveBeenCalled();
    expect(f.handleIncoming).not.toHaveBeenCalled();
  });
  it('routes the same sender to the account and outgoing Nita number of each receiving channel', async () => {
    const fixture = createFixture();
    const secondPhoneId = '3333333333';
    const secondAccountId = '00000000-0000-4000-8000-000000000002';
    fixture.resolve.mockImplementation((phoneNumberId: string) =>
      Promise.resolve(
        phoneNumberId === PHONE_NUMBER_ID
          ? { accountId: ACCOUNT_ID, phoneNumberId: PHONE_NUMBER_ID }
          : phoneNumberId === secondPhoneId
            ? { accountId: secondAccountId, phoneNumberId: secondPhoneId }
            : null,
      ),
    );
    const message = { id: MESSAGE_ID, from: CUSTOMER, type: 'text', text: { body: 'Hola' } };

    await fixture.service.handleWebhook(payload(message), 'sha256=valid');
    await fixture.service.handleWebhook(
      payload({ ...message, id: 'wamid.inbound-2' }, { phoneId: secondPhoneId }),
      'sha256=valid',
    );

    expect(fixture.handleIncoming).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ accountId: ACCOUNT_ID, customerIdentifier: CUSTOMER }),
    );
    expect(fixture.handleIncoming).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ accountId: secondAccountId, customerIdentifier: CUSTOMER }),
    );
    expect(fixture.sendMessage).toHaveBeenNthCalledWith(
      1,
      PHONE_NUMBER_ID,
      CUSTOMER,
      expect.any(Object),
    );
    expect(fixture.sendMessage).toHaveBeenNthCalledWith(
      2,
      secondPhoneId,
      CUSTOMER,
      expect.any(Object),
    );
  });

  it('processes signed text and sends every structured Nita response', async () => {
    const fixture = createFixture();
    const rawBody = payload({
      id: MESSAGE_ID,
      from: CUSTOMER,
      type: 'text',
      text: { body: 'Hola' },
    });

    await expect(fixture.service.handleWebhook(rawBody, 'sha256=valid')).resolves.toEqual({
      received: true,
    });

    expect(fixture.assertValidPayload).toHaveBeenCalledWith(rawBody, 'sha256=valid');
    expect(fixture.claim).toHaveBeenCalledWith(MESSAGE_ID);
    expect(fixture.handleIncoming).toHaveBeenCalledWith({
      type: 'text',
      customerIdentifier: CUSTOMER,
      accountId: ACCOUNT_ID,
      text: 'Hola',
    });
    expect(fixture.sendMessage).toHaveBeenCalledWith(PHONE_NUMBER_ID, CUSTOMER, {
      type: 'text',
      text: 'Respuesta de Nita',
    });
  });

  it.each([
    [
      'button_reply',
      {
        type: 'button_reply',
        button_reply: { id: WHATSAPP_BUTTON_IDS.SIZE_SMALL, title: 'Pequeño' },
      },
    ],
    [
      'list_reply',
      {
        type: 'list_reply',
        list_reply: { id: WHATSAPP_BUTTON_IDS.DETAIL_DETAILED, title: 'Detallado' },
      },
    ],
  ])('maps an interactive %s using its stable ID', async (_type, interactive) => {
    const fixture = createFixture();
    const expectedId =
      'button_reply' in interactive ? interactive.button_reply.id : interactive.list_reply.id;

    await fixture.service.handleWebhook(
      payload({ id: MESSAGE_ID, from: CUSTOMER, type: 'interactive', interactive }),
      'sha256=valid',
    );

    expect(fixture.handleIncoming).toHaveBeenCalledWith({
      type: 'button_reply',
      customerIdentifier: CUSTOMER,
      accountId: ACCOUNT_ID,
      buttonId: expectedId,
    });
  });

  it('downloads an image from its Meta media ID before entering the existing flow', async () => {
    const fixture = createFixture();

    await fixture.service.handleWebhook(
      payload({
        id: MESSAGE_ID,
        from: CUSTOMER,
        type: 'image',
        image: { id: 'media-123', mime_type: 'image/png' },
      }),
      'sha256=valid',
    );

    expect(fixture.downloadImage).toHaveBeenCalledWith(PHONE_NUMBER_ID, 'media-123');
    expect(fixture.handleIncoming).toHaveBeenCalledWith({
      type: 'image',
      customerIdentifier: CUSTOMER,
      accountId: ACCOUNT_ID,
      image: {
        content: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
        mimeType: 'image/png',
        fileName: 'whatsapp-reference.png',
      },
    });
  });

  it('does not process or send a duplicated WhatsApp message ID', async () => {
    const fixture = createFixture();
    fixture.claim.mockResolvedValue(false);

    await fixture.service.handleWebhook(
      payload({ id: MESSAGE_ID, from: CUSTOMER, type: 'text', text: { body: 'Hola' } }),
      'sha256=valid',
    );

    expect(fixture.handleIncoming).not.toHaveBeenCalled();
    expect(fixture.sendMessage).not.toHaveBeenCalled();
  });

  it('claims the same simultaneous WhatsApp message ID only once before side effects', async () => {
    const fixture = createFixture();
    const claimedIds = new Set<string>();
    fixture.claim.mockImplementation((messageId: string) => {
      if (claimedIds.has(messageId)) {
        return Promise.resolve(false);
      }

      claimedIds.add(messageId);
      return Promise.resolve(true);
    });
    const rawBody = payload({
      id: MESSAGE_ID,
      from: CUSTOMER,
      type: 'text',
      text: { body: 'Hola' },
    });

    await Promise.all([
      fixture.service.handleWebhook(rawBody, 'sha256=valid'),
      fixture.service.handleWebhook(rawBody, 'sha256=valid'),
    ]);

    expect(fixture.claim).toHaveBeenCalledTimes(2);
    expect(fixture.handleIncoming).toHaveBeenCalledOnce();
    expect(fixture.sendMessage).toHaveBeenCalledOnce();
  });

  it('retains the message ID if delivery fails after Nita advanced the conversation', async () => {
    const fixture = createFixture();
    fixture.sendMessage.mockRejectedValue(new Error('provider unavailable'));

    await expect(
      fixture.service.handleWebhook(
        payload({ id: MESSAGE_ID, from: CUSTOMER, type: 'text', text: { body: 'Hola' } }),
        'sha256=valid',
      ),
    ).rejects.toThrow('provider unavailable');
    expect(fixture.release).not.toHaveBeenCalled();
  });

  it('releases the message ID when processing fails before Nita advances the conversation', async () => {
    const fixture = createFixture();
    fixture.downloadImage.mockRejectedValue(new Error('media unavailable'));

    await expect(
      fixture.service.handleWebhook(
        payload({ id: MESSAGE_ID, from: CUSTOMER, type: 'image', image: { id: 'media-123' } }),
        'sha256=valid',
      ),
    ).rejects.toThrow('media unavailable');
    expect(fixture.release).toHaveBeenCalledWith(MESSAGE_ID);
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

      expect(fixture.claim).not.toHaveBeenCalled();
      expect(fixture.handleIncoming).not.toHaveBeenCalled();
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

    expect(fixture.claim).not.toHaveBeenCalled();
    expect(fixture.handleIncoming).not.toHaveBeenCalled();
    expect(fixture.sendMessage).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith('whatsapp.webhook.ignored', {
      reason: 'statuses_without_messages',
      object: 'whatsapp_business_account',
      field: 'change.value.messages',
      hasMessages: false,
      hasStatuses: true,
    });
  });
});

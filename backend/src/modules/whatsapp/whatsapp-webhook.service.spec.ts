import { ConfigService } from '@nestjs/config';
import { SafeStructuredLogger } from '../../infrastructure/observability/safe-structured-logger.js';
import { WhatsAppAdapter, WHATSAPP_BUTTON_IDS } from '../chatbot/whatsapp/whatsapp.adapter.js';
import { WhatsAppCloudApiClient } from './whatsapp-cloud-api.client.js';
import { WhatsAppInboundMessageRepository } from './whatsapp-inbound-message.repository.js';
import { WhatsAppSignatureService } from './whatsapp-signature.service.js';
import { WhatsAppWebhookService } from './whatsapp-webhook.service.js';

const BUSINESS_ACCOUNT_ID = '1111111111';
const PHONE_NUMBER_ID = '2222222222';
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
  const sendMessage = vi.fn().mockResolvedValue(undefined);
  const downloadImage = vi.fn().mockResolvedValue({
    content: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    mimeType: 'image/png',
    fileName: 'whatsapp-reference.png',
  });
  const service = new WhatsAppWebhookService(
    new ConfigService({
      WHATSAPP_BUSINESS_ACCOUNT_ID: BUSINESS_ACCOUNT_ID,
      WHATSAPP_PHONE_NUMBER_ID: PHONE_NUMBER_ID,
    }),
    { assertValidPayload } as unknown as WhatsAppSignatureService,
    { claim, release } as unknown as WhatsAppInboundMessageRepository,
    { handleIncoming } as unknown as WhatsAppAdapter,
    { sendMessage, downloadImage } as unknown as WhatsAppCloudApiClient,
  );

  return {
    service,
    assertValidPayload,
    claim,
    release,
    handleIncoming,
    sendMessage,
    downloadImage,
  };
}

function observeServiceLogs(service: WhatsAppWebhookService) {
  return vi.spyOn(Reflect.get(service, 'logger') as SafeStructuredLogger, 'info');
}

describe('WhatsAppWebhookService', () => {
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
      text: 'Hola',
    });
    expect(fixture.sendMessage).toHaveBeenCalledWith(CUSTOMER, {
      type: 'text',
      text: 'Respuesta de Nita',
    });
  });

  it.each([
    [
      'button_reply',
      {
        type: 'button_reply',
        button_reply: { id: WHATSAPP_BUTTON_IDS.SMALL, title: 'Pequeño' },
      },
    ],
    [
      'list_reply',
      {
        type: 'list_reply',
        list_reply: { id: WHATSAPP_BUTTON_IDS.DETAILED, title: 'Detallado' },
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

    expect(fixture.downloadImage).toHaveBeenCalledWith('media-123');
    expect(fixture.handleIncoming).toHaveBeenCalledWith({
      type: 'image',
      customerIdentifier: CUSTOMER,
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
    expect(info).toHaveBeenCalledWith('whatsapp.webhook.ignored', {
      reason: 'statuses_without_messages',
      object: 'whatsapp_business_account',
      field: 'change.value.messages',
      hasMessages: false,
      hasStatuses: true,
    });
  });
});

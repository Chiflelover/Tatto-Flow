import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SafeStructuredLogger } from '../../infrastructure/observability/safe-structured-logger.js';
import {
  WhatsAppAdapter,
  type WhatsAppInboundMessage,
} from '../chatbot/whatsapp/whatsapp.adapter.js';
import { WhatsAppCloudApiClient } from './whatsapp-cloud-api.client.js';
import { getRequiredWhatsAppValue } from './whatsapp.config.js';
import { WhatsAppInboundMessageRepository } from './whatsapp-inbound-message.repository.js';
import { WhatsAppSignatureService } from './whatsapp-signature.service.js';

interface MetaMessage {
  id?: unknown;
  from?: unknown;
  type?: unknown;
  text?: { body?: unknown };
  image?: { id?: unknown };
  interactive?: {
    type?: unknown;
    button_reply?: { id?: unknown };
    list_reply?: { id?: unknown };
  };
}

interface MetaChangeValue {
  metadata?: { phone_number_id?: unknown };
  messages?: unknown;
  statuses?: unknown;
}

type WhatsAppWebhookIgnoredReason =
  | 'unexpected_object'
  | 'entries_missing'
  | 'invalid_entry'
  | 'business_account_id_mismatch'
  | 'changes_missing'
  | 'invalid_change'
  | 'unexpected_change_field'
  | 'invalid_change_value'
  | 'metadata_missing'
  | 'phone_number_id_mismatch'
  | 'statuses_without_messages'
  | 'messages_missing'
  | 'invalid_message_shape';

@Injectable()
export class WhatsAppWebhookService {
  private readonly logger = new SafeStructuredLogger(WhatsAppWebhookService.name);

  constructor(
    @Inject(ConfigService)
    private readonly config: ConfigService,
    @Inject(WhatsAppSignatureService)
    private readonly signatures: WhatsAppSignatureService,
    @Inject(WhatsAppInboundMessageRepository)
    private readonly messages: WhatsAppInboundMessageRepository,
    @Inject(WhatsAppAdapter)
    private readonly adapter: WhatsAppAdapter,
    @Inject(WhatsAppCloudApiClient)
    private readonly cloudApi: WhatsAppCloudApiClient,
  ) {}

  verifyChallenge(mode: unknown, verifyToken: unknown, challenge: unknown): string {
    return this.signatures.verifyChallenge(mode, verifyToken, challenge);
  }

  async handleWebhook(rawBody: Buffer, signature: string | undefined): Promise<{ received: true }> {
    this.signatures.assertValidPayload(rawBody, signature);
    const payload = this.parsePayload(rawBody);

    this.logger.info('whatsapp.webhook.received');

    if (payload.object !== 'whatsapp_business_account') {
      this.logIgnored('unexpected_object', payload.object, 'object');
      return { received: true };
    }

    const businessAccountId = getRequiredWhatsAppValue(this.config, 'WHATSAPP_BUSINESS_ACCOUNT_ID');
    const phoneNumberId = getRequiredWhatsAppValue(this.config, 'WHATSAPP_PHONE_NUMBER_ID');
    const entries = Array.isArray(payload.entry) ? payload.entry : [];

    if (entries.length === 0) {
      this.logIgnored('entries_missing', payload.object, 'entry');
    }

    for (const entry of entries) {
      if (!this.isRecord(entry)) {
        this.logIgnored('invalid_entry', payload.object, 'entry[]');
        continue;
      }

      if (entry.id !== businessAccountId) {
        this.logIgnored('business_account_id_mismatch', payload.object, 'entry.id');
        continue;
      }

      if (!Array.isArray(entry.changes) || entry.changes.length === 0) {
        this.logIgnored('changes_missing', payload.object, 'entry.changes');
        continue;
      }

      for (const change of entry.changes) {
        if (!this.isRecord(change)) {
          this.logIgnored('invalid_change', payload.object, 'entry.changes[]');
          continue;
        }

        if (change.field !== 'messages') {
          this.logIgnored(
            'unexpected_change_field',
            payload.object,
            this.diagnosticText(change.field),
          );
          continue;
        }

        if (!this.isRecord(change.value)) {
          this.logIgnored('invalid_change_value', payload.object, 'change.value');
          continue;
        }

        const value = change.value as MetaChangeValue;

        if (!this.isRecord(value.metadata)) {
          this.logIgnored('metadata_missing', payload.object, 'change.value.metadata', value);
          continue;
        }

        if (value.metadata.phone_number_id !== phoneNumberId) {
          this.logIgnored(
            'phone_number_id_mismatch',
            payload.object,
            'change.value.metadata.phone_number_id',
            value,
          );
          continue;
        }

        if (!Array.isArray(value.messages) || value.messages.length === 0) {
          this.logIgnored(
            this.hasItems(value.statuses) ? 'statuses_without_messages' : 'messages_missing',
            payload.object,
            'change.value.messages',
            value,
          );
          continue;
        }

        for (const message of value.messages) {
          if (this.isRecord(message)) {
            await this.processMessage(message);
          } else {
            this.logIgnored(
              'invalid_message_shape',
              payload.object,
              'change.value.messages[]',
              value,
            );
          }
        }
      }
    }

    return { received: true };
  }

  private async processMessage(message: MetaMessage): Promise<void> {
    const messageId = this.requiredString(message.id, 'ID');
    const customerIdentifier = this.requiredString(message.from, 'remitente');

    if (!/^\d{5,20}$/.test(customerIdentifier)) {
      throw new BadRequestException('El remitente de WhatsApp no es válido.');
    }

    if (!(await this.messages.claim(messageId))) {
      this.logger.info('whatsapp.message.duplicate_ignored', { whatsappMessageId: messageId });
      return;
    }

    this.logger.info('whatsapp.message.accepted', {
      whatsappMessageId: messageId,
      messageType: typeof message.type === 'string' ? message.type : 'unknown',
    });

    let chatbotProcessed = false;

    try {
      const inbound = await this.toInboundMessage(message, customerIdentifier);

      if (!inbound) {
        return;
      }

      const outbound = await this.adapter.handleIncoming(inbound);
      chatbotProcessed = true;

      for (const response of outbound) {
        await this.cloudApi.sendMessage(customerIdentifier, response);
        this.logger.info('whatsapp.response.sent', {
          whatsappMessageId: messageId,
          responseType: response.type,
        });
      }
    } catch (error) {
      if (!chatbotProcessed) {
        await this.messages.release(messageId);
      }

      this.logger.error('whatsapp.message.failed', {
        whatsappMessageId: messageId,
        stage: chatbotProcessed ? 'response' : 'processing',
      });

      throw error;
    }
  }

  private async toInboundMessage(
    message: MetaMessage,
    customerIdentifier: string,
  ): Promise<WhatsAppInboundMessage | null> {
    switch (message.type) {
      case 'text':
        return {
          type: 'text',
          customerIdentifier,
          text: this.requiredString(message.text?.body, 'texto', 1_000),
        };
      case 'image':
        return {
          type: 'image',
          customerIdentifier,
          image: await this.cloudApi.downloadImage(
            this.requiredString(message.image?.id, 'media ID'),
          ),
        };
      case 'interactive': {
        const interactive = message.interactive;

        if (interactive?.type === 'button_reply') {
          return {
            type: 'button_reply',
            customerIdentifier,
            buttonId: this.requiredString(interactive.button_reply?.id, 'button reply'),
          };
        }

        if (interactive?.type === 'list_reply') {
          return {
            type: 'button_reply',
            customerIdentifier,
            buttonId: this.requiredString(interactive.list_reply?.id, 'list reply'),
          };
        }

        return null;
      }
      default:
        return null;
    }
  }

  private parsePayload(rawBody: Buffer): Record<string, unknown> {
    try {
      const payload: unknown = JSON.parse(rawBody.toString('utf8'));

      if (!this.isRecord(payload)) {
        throw new Error();
      }

      return payload;
    } catch {
      throw new BadRequestException('El webhook de WhatsApp no contiene JSON válido.');
    }
  }

  private requiredString(value: unknown, field: string, maxLength = 255): string {
    if (typeof value !== 'string' || !value || value.length > maxLength) {
      throw new BadRequestException(`El mensaje de WhatsApp no contiene ${field} válido.`);
    }

    return value;
  }

  private logIgnored(
    reason: WhatsAppWebhookIgnoredReason,
    object: unknown,
    field: string,
    value?: MetaChangeValue,
  ): void {
    this.logger.info('whatsapp.webhook.ignored', {
      reason,
      object: this.diagnosticText(object),
      field,
      hasMessages: this.hasItems(value?.messages),
      hasStatuses: this.hasItems(value?.statuses),
    });
  }

  private diagnosticText(value: unknown): string {
    return typeof value === 'string' && value.length <= 64 ? value : 'invalid';
  }

  private hasItems(value: unknown): boolean {
    return Array.isArray(value) && value.length > 0;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }
}

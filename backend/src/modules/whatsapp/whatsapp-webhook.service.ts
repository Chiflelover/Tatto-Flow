import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SafeStructuredLogger } from '../../infrastructure/observability/safe-structured-logger.js';
import { getRequiredWhatsAppValue } from './whatsapp.config.js';
import { WhatsAppSignatureService } from './whatsapp-signature.service.js';
import { WhatsAppChannelService } from './whatsapp-channel.service.js';
import type { WhatsAppChannel } from '../../generated/prisma/client.js';
import { WhatsAppJobRepository, type WhatsAppJobInput } from './whatsapp-job.repository.js';
import { WhatsAppJobDispatcher } from './whatsapp-job-dispatcher.service.js';

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
    @Inject(WhatsAppChannelService)
    private readonly channels: WhatsAppChannelService,
    @Inject(WhatsAppJobRepository) private readonly jobs: WhatsAppJobRepository,
    @Inject(WhatsAppJobDispatcher) private readonly dispatcher: WhatsAppJobDispatcher,
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

        const receivingPhoneNumberId = value.metadata.phone_number_id;
        if (typeof receivingPhoneNumberId !== 'string' || !/^\d+$/.test(receivingPhoneNumberId)) {
          this.logIgnored(
            'phone_number_id_mismatch',
            payload.object,
            'change.value.metadata.phone_number_id',
            value,
          );
          continue;
        }

        const channel = await this.channels.resolve(receivingPhoneNumberId);
        if (!channel) {
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
            await this.processMessage(message, channel);
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

  private async processMessage(message: MetaMessage, channel: WhatsAppChannel): Promise<void> {
    const messageId = this.requiredString(message.id, 'ID');
    const customerIdentifier = this.requiredString(message.from, 'remitente');

    if (!/^\d{5,20}$/.test(customerIdentifier)) {
      throw new BadRequestException('El remitente de WhatsApp no es válido.');
    }

    const input = this.jobInput(message);
    if (!input) return;
    const queued = await this.jobs.enqueue(messageId, channel, customerIdentifier, input);
    if (queued.customerId) {
      this.logger.info('whatsapp.message.queued', {
        whatsappMessageId: messageId,
        accountId: channel.accountId,
      });
      this.dispatcher.wake(channel.accountId, queued.customerId);
      return;
    }
  }

  private jobInput(message: MetaMessage): WhatsAppJobInput | null {
    if (message.type === 'text')
      return { type: 'text', text: this.requiredString(message.text?.body, 'texto', 1000) };
    if (message.type === 'image')
      return { type: 'image', mediaId: this.requiredString(message.image?.id, 'media ID') };
    if (message.type === 'interactive') {
      if (message.interactive?.type === 'button_reply')
        return {
          type: 'button_reply',
          buttonId: this.requiredString(message.interactive.button_reply?.id, 'button reply'),
        };
      if (message.interactive?.type === 'list_reply')
        return {
          type: 'button_reply',
          buttonId: this.requiredString(message.interactive.list_reply?.id, 'list reply'),
        };
    }
    return null;
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

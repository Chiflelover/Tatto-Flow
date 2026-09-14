import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsAppAdapter, type WhatsAppInboundMessage } from '../chatbot/whatsapp/whatsapp.adapter.js';
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
}

@Injectable()
export class WhatsAppWebhookService {
  constructor(
    private readonly config: ConfigService,
    private readonly signatures: WhatsAppSignatureService,
    private readonly messages: WhatsAppInboundMessageRepository,
    private readonly adapter: WhatsAppAdapter,
    private readonly cloudApi: WhatsAppCloudApiClient,
  ) {}

  verifyChallenge(mode: unknown, verifyToken: unknown, challenge: unknown): string {
    return this.signatures.verifyChallenge(mode, verifyToken, challenge);
  }

  async handleWebhook(
    rawBody: Buffer,
    signature: string | undefined,
  ): Promise<{ received: true }> {
    this.signatures.assertValidPayload(rawBody, signature);
    const payload = this.parsePayload(rawBody);

    if (payload.object !== 'whatsapp_business_account') {
      return { received: true };
    }

    const businessAccountId = getRequiredWhatsAppValue(
      this.config,
      'WHATSAPP_BUSINESS_ACCOUNT_ID',
    );
    const phoneNumberId = getRequiredWhatsAppValue(this.config, 'WHATSAPP_PHONE_NUMBER_ID');
    const entries = Array.isArray(payload.entry) ? payload.entry : [];

    for (const entry of entries) {
      if (!this.isRecord(entry) || entry.id !== businessAccountId || !Array.isArray(entry.changes)) {
        continue;
      }

      for (const change of entry.changes) {
        if (!this.isRecord(change) || change.field !== 'messages' || !this.isRecord(change.value)) {
          continue;
        }

        const value = change.value as MetaChangeValue;

        if (
          !this.isRecord(value.metadata) ||
          value.metadata.phone_number_id !== phoneNumberId ||
          !Array.isArray(value.messages)
        ) {
          continue;
        }

        for (const message of value.messages) {
          if (this.isRecord(message)) {
            await this.processMessage(message as MetaMessage);
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
      return;
    }

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
      }
    } catch (error) {
      if (!chatbotProcessed) {
        await this.messages.release(messageId);
      }

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

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }
}

import { Module } from '@nestjs/common';
import { ChatbotModule } from '../chatbot/chatbot.module.js';
import { WhatsAppCloudApiClient } from './whatsapp-cloud-api.client.js';
import { WhatsAppController } from './whatsapp.controller.js';
import { WhatsAppInboundMessageRepository } from './whatsapp-inbound-message.repository.js';
import { WhatsAppSignatureService } from './whatsapp-signature.service.js';
import { WhatsAppWebhookService } from './whatsapp-webhook.service.js';

@Module({
  imports: [ChatbotModule],
  controllers: [WhatsAppController],
  providers: [
    WhatsAppCloudApiClient,
    WhatsAppInboundMessageRepository,
    WhatsAppSignatureService,
    WhatsAppWebhookService,
  ],
})
export class WhatsAppModule {}

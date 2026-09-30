import { Module } from '@nestjs/common';
import { ChatbotModule } from '../chatbot/chatbot.module.js';
import { WhatsAppCloudApiClient } from './whatsapp-cloud-api.client.js';
import { WhatsAppController } from './whatsapp.controller.js';
import { WhatsAppInboundMessageRepository } from './whatsapp-inbound-message.repository.js';
import { WhatsAppSignatureService } from './whatsapp-signature.service.js';
import { WhatsAppWebhookService } from './whatsapp-webhook.service.js';
import { WhatsAppChannelService } from './whatsapp-channel.service.js';
import { WhatsAppV2DeliveryService } from './whatsapp-v2-delivery.service.js';
import { WhatsAppJobRepository } from './whatsapp-job.repository.js';
import { WhatsAppJobProcessor } from './whatsapp-job-processor.service.js';
import { WhatsAppJobDispatcher } from './whatsapp-job-dispatcher.service.js';
import { WhatsAppJobsController } from './whatsapp-jobs.controller.js';

@Module({
  imports: [ChatbotModule],
  controllers: [WhatsAppController, WhatsAppJobsController],
  providers: [
    WhatsAppCloudApiClient,
    WhatsAppInboundMessageRepository,
    WhatsAppSignatureService,
    WhatsAppWebhookService,
    WhatsAppChannelService,
    WhatsAppV2DeliveryService,
    WhatsAppJobRepository,
    WhatsAppJobProcessor,
    WhatsAppJobDispatcher,
  ],
})
export class WhatsAppModule {}

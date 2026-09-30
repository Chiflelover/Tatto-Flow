import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module.js';
import { CustomersModule } from '../customers/customers.module.js';
import { ImageAnalysisModule } from '../image-analysis/image-analysis.module.js';
import { ChatbotService } from './chatbot.service.js';
import { NitaStateMachine } from './domain/nita-state-machine.js';
import { NitaBusinessHoursService } from './nita-business-hours.service.js';
import { WhatsAppAdapter } from './whatsapp/whatsapp.adapter.js';
import { NitaV2IntakeService } from './nita-v2-intake.service.js';
import { NitaV2AnalysisService } from './nita-v2-analysis.service.js';
import { StorageModule } from '../storage/storage.module.js';

@Module({
  imports: [CustomersModule, ConversationsModule, ImageAnalysisModule, StorageModule],
  providers: [
    ChatbotService,
    NitaBusinessHoursService,
    NitaStateMachine,
    WhatsAppAdapter,
    NitaV2IntakeService,
    NitaV2AnalysisService,
  ],
  exports: [ChatbotService, WhatsAppAdapter],
})
export class ChatbotModule {}

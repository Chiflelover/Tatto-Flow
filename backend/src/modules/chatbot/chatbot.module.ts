import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module.js';
import { CustomersModule } from '../customers/customers.module.js';
import { ImageAnalysisModule } from '../image-analysis/image-analysis.module.js';
import { ChatbotService } from './chatbot.service.js';
import { NitaV2StateMachine } from './domain/nita-v2-state-machine.js';
import { NitaBusinessHoursService } from './nita-business-hours.service.js';
import { WhatsAppAdapter } from './whatsapp/whatsapp.adapter.js';
import { NitaV2IntakeService } from './nita-v2-intake.service.js';
import { NitaV2AnalysisService } from './nita-v2-analysis.service.js';
import { StorageModule } from '../storage/storage.module.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { NitaV2CompletionService } from './nita-v2-completion.service.js';

@Module({
  imports: [
    CustomersModule,
    ConversationsModule,
    ImageAnalysisModule,
    StorageModule,
    PricingModule,
  ],
  providers: [
    ChatbotService,
    NitaBusinessHoursService,
    NitaV2StateMachine,
    WhatsAppAdapter,
    NitaV2IntakeService,
    NitaV2AnalysisService,
    NitaV2CompletionService,
  ],
  exports: [ChatbotService, WhatsAppAdapter, NitaV2AnalysisService, NitaV2CompletionService],
})
export class ChatbotModule {}

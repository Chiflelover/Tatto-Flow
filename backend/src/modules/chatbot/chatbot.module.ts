import { Module } from '@nestjs/common';
import { ConversationsModule } from '../conversations/conversations.module.js';
import { CustomersModule } from '../customers/customers.module.js';
import { ImageAnalysisModule } from '../image-analysis/image-analysis.module.js';
import { ChatbotService } from './chatbot.service.js';
import { NitaStateMachine } from './domain/nita-state-machine.js';
import { WhatsAppAdapter } from './whatsapp/whatsapp.adapter.js';

@Module({
  imports: [CustomersModule, ConversationsModule, ImageAnalysisModule],
  providers: [ChatbotService, NitaStateMachine, WhatsAppAdapter],
  exports: [ChatbotService, WhatsAppAdapter],
})
export class ChatbotModule {}

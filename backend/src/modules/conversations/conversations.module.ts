import { Module } from '@nestjs/common';
import { ConversationAbandonmentService } from './conversation-abandonment.service.js';
import { ConversationsService } from './conversations.service.js';

@Module({
  providers: [ConversationsService, ConversationAbandonmentService],
  exports: [ConversationsService, ConversationAbandonmentService],
})
export class ConversationsModule {}

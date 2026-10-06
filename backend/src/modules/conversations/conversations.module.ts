import { Module } from '@nestjs/common';
import { ConversationAbandonmentController } from './conversation-abandonment.controller.js';
import { ConversationAbandonmentService } from './conversation-abandonment.service.js';
import { ConversationsService } from './conversations.service.js';

@Module({
  controllers: [ConversationAbandonmentController],
  providers: [ConversationsService, ConversationAbandonmentService],
  exports: [ConversationsService, ConversationAbandonmentService],
})
export class ConversationsModule {}

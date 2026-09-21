import { Module } from '@nestjs/common';
import { LeadScoringModule } from '../lead-scoring/lead-scoring.module.js';
import { ConversationAbandonmentService } from './conversation-abandonment.service.js';
import { ConversationsService } from './conversations.service.js';

@Module({
  imports: [LeadScoringModule],
  providers: [ConversationsService, ConversationAbandonmentService],
  exports: [ConversationsService, ConversationAbandonmentService],
})
export class ConversationsModule {}

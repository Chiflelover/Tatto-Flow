import { Module } from '@nestjs/common';
import { ConversationAbandonmentService } from './conversation-abandonment.service.js';
import { ConversationsService } from './conversations.service.js';
import { IncompleteConversationCleanupService } from './infrastructure/incomplete-conversation-cleanup.service.js';
import { TEMPORARY_IMAGE_STORAGE } from './ports/temporary-image-storage.port.js';

@Module({
  providers: [
    ConversationsService,
    ConversationAbandonmentService,
    {
      provide: TEMPORARY_IMAGE_STORAGE,
      useClass: IncompleteConversationCleanupService,
    },
  ],
  exports: [ConversationsService, ConversationAbandonmentService],
})
export class ConversationsModule {}

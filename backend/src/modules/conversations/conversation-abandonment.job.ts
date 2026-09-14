import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConversationAbandonmentService } from './conversation-abandonment.service.js';

@Injectable()
export class ConversationAbandonmentJob {
  private readonly logger = new Logger(ConversationAbandonmentJob.name);

  constructor(private readonly abandonmentService: ConversationAbandonmentService) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'conversation-abandonment' })
  async abandonInactiveConversations(): Promise<void> {
    const abandonedCount = await this.abandonmentService.abandonInactive();

    if (abandonedCount > 0) {
      this.logger.log(`Marked ${abandonedCount} inactive conversation(s) as abandoned.`);
    }
  }
}

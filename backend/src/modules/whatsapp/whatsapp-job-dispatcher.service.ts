import { Inject, Injectable } from '@nestjs/common';
import { waitUntil } from '@vercel/functions';
import { SafeStructuredLogger } from '../../infrastructure/observability/safe-structured-logger.js';
import { WhatsAppJobProcessor } from './whatsapp-job-processor.service.js';

@Injectable()
export class WhatsAppJobDispatcher {
  private readonly logger = new SafeStructuredLogger(WhatsAppJobDispatcher.name);
  constructor(@Inject(WhatsAppJobProcessor) private readonly processor: WhatsAppJobProcessor) {}
  wake(accountId: string, customerId: string): void {
    const work = Promise.resolve()
      .then(async () => {
        const started = Date.now();
        // Drain quick intake bursts. Leave enough of the 300s invocation for a heavy job.
        do {
          const result = await this.processor.runNext(accountId, customerId);
          if (!result.processed || result.status !== 'COMPLETED') break;
        } while (Date.now() - started < 30_000);
      })
      .catch(() => {
        this.logger.error('whatsapp.job.dispatch_failed', { accountId, customerId });
      });
    waitUntil(work);
  }
}

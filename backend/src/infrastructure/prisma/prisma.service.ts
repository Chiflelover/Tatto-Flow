import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { SafeStructuredLogger } from '../observability/safe-structured-logger.js';

@Injectable()
export class PrismaService
  extends PrismaClient<{
    adapter: PrismaPg;
    log: [{ emit: 'event'; level: 'error' }];
  }>
  implements OnModuleDestroy
{
  private readonly safeLogger = new SafeStructuredLogger(PrismaService.name);

  constructor(@Inject(ConfigService) configService: ConfigService) {
    const connectionString = configService.getOrThrow<string>('DATABASE_URL');

    super({
      adapter: new PrismaPg({
        connectionString,
        max: 1,
      }),
      log: [{ emit: 'event', level: 'error' }],
    });

    this.$on('error', (event: Prisma.LogEvent) => {
      this.safeLogger.error('database.prisma.error', {
        errorKind: this.classifyError(event.message),
      });
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  private classifyError(message: string): 'connection' | 'prisma' {
    return /connection|max clients|pool|timed?\s*out|ECONN/i.test(message)
      ? 'connection'
      : 'prisma';
  }
}

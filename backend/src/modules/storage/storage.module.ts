import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { StorageMode } from '../../config/environment.validation.js';
import { CronSecretGuard } from './cron-secret.guard.js';
import { InMemoryStorageService } from './in-memory-storage.service.js';
import { LeadImageRetentionService } from './lead-image-retention.service.js';
import { LeadImageService } from './lead-image.service.js';
import { RetentionCronController } from './retention-cron.controller.js';
import { StorageService } from './storage.service.js';
import { SupabaseStorageService } from './supabase-storage.service.js';

@Global()
@Module({
  controllers: [RetentionCronController],
  providers: [
    {
      provide: StorageService,
      inject: [ConfigService],
      useFactory: async (config: ConfigService): Promise<StorageService> => {
        const mode = config.getOrThrow<StorageMode>('STORAGE_MODE');

        if (mode === 'supabase') {
          const storage = new SupabaseStorageService(
            config.getOrThrow<string>('SUPABASE_URL'),
            config.getOrThrow<string>('SUPABASE_SECRET_KEY'),
            config.getOrThrow<string>('SUPABASE_STORAGE_BUCKET'),
          );
          await storage.verifyPrivateBucket();
          return storage;
        }

        return new InMemoryStorageService();
      },
    },
    LeadImageService,
    LeadImageRetentionService,
    CronSecretGuard,
  ],
  exports: [StorageService, LeadImageService, LeadImageRetentionService],
})
export class StorageModule {}

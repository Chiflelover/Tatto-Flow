import { Module } from '@nestjs/common';
import { AdminModule } from './modules/admin/admin.module.js';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { validateEnvironment } from './config/environment.validation.js';
import { PrismaModule } from './infrastructure/prisma/prisma.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CalibrationModule } from './modules/calibration/calibration.module.js';
import { ChatbotModule } from './modules/chatbot/chatbot.module.js';
import { DashboardModule } from './modules/dashboard/dashboard.module.js';
import { ImageManagementModule } from './modules/image-management/image-management.module.js';
import { StorageModule } from './modules/storage/storage.module.js';
import { WhatsAppModule } from './modules/whatsapp/whatsapp.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      validate: validateEnvironment,
    }),
    PrismaModule,
    StorageModule,
    AuthModule,
    CalibrationModule,
    AdminModule,
    ChatbotModule,
    WhatsAppModule,
    DashboardModule,
    ImageManagementModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CalibrationController } from './calibration.controller.js';
import { CalibrationService } from './calibration.service.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';

@Module({
  imports: [AuthModule],
  controllers: [CalibrationController, CatalogController],
  providers: [CalibrationService, CatalogService],
  exports: [CalibrationService],
})
export class CalibrationModule {}

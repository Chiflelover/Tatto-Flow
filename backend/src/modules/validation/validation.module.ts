import { Module } from '@nestjs/common';
import { ValidationService } from './validation.service.js';

@Module({
  providers: [ValidationService],
  exports: [ValidationService],
})
export class ValidationModule {}

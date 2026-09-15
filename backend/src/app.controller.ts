import { Controller, Get, Inject } from '@nestjs/common';
import { AppService } from './app.service.js';

@Controller('health')
export class AppController {
  constructor(@Inject(AppService) private readonly appService: AppService) {}

  @Get()
  getHealth() {
    return this.appService.getHealth();
  }
}

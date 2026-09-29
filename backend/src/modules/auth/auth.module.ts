import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { SessionAuthGuard } from './session-auth.guard.js';
import { AdminGuard, TattooArtistGuard } from './role.guard.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionAuthGuard, AdminGuard, TattooArtistGuard],
  exports: [AuthService, SessionAuthGuard, AdminGuard, TattooArtistGuard],
})
export class AuthModule {}

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { SESSION_COOKIE_NAME } from './auth.constants.js';
import { AuthService } from './auth.service.js';
import type { AuthenticatedRequest } from './auth.types.js';
import { LoginDto } from './dto/auth.dto.js';
import { SessionAuthGuard } from './session-auth.guard.js';

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.authService.login(dto.email, dto.password);

    response.cookie(
      SESSION_COOKIE_NAME,
      result.sessionToken,
      this.authService.sessionCookieOptions(result.expiresAt),
    );

    return { user: result.user };
  }

  @Get('session')
  @UseGuards(SessionAuthGuard)
  getSession(@Req() request: AuthenticatedRequest) {
    return { user: request.tattooArtist };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(SessionAuthGuard)
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.authService.logout(request.sessionToken);
    response.clearCookie(SESSION_COOKIE_NAME, this.authService.sessionCookieOptions());

    return { success: true };
  }
}

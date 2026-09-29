import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../auth/role.guard.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { AdminService } from './admin.service.js';
import { CreateArtistAccountDto, UpdateArtistAccountDto } from './dto/admin-account.dto.js';

@Controller('admin/accounts')
@UseGuards(SessionAuthGuard, AdminGuard)
export class AdminController {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}

  @Get()
  list() {
    return this.admin.listAccounts();
  }

  @Get(':id')
  get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.admin.getAccount(id);
  }

  @Post()
  create(@Body() dto: CreateArtistAccountDto) {
    return this.admin.createAccount(dto);
  }

  @Patch(':id')
  update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateArtistAccountDto,
  ) {
    return this.admin.updateAccount(id, dto);
  }
}

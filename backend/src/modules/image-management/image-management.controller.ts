import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { AdminGuard, TattooArtistGuard } from '../auth/role.guard.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { DeleteImagesDto, ImageListQueryDto } from './image-management.dto.js';
import { ImageManagementService } from './image-management.service.js';

@Controller('admin/images')
@UseGuards(SessionAuthGuard, AdminGuard)
export class AdminImagesController {
  constructor(@Inject(ImageManagementService) private readonly images: ImageManagementService) {}

  @Get()
  list(@Query() query: ImageListQueryDto) {
    return this.images.listAll(query);
  }

  @Post('delete')
  delete(@Body() dto: DeleteImagesDto, @Req() req: AuthenticatedRequest) {
    return this.images.deleteMany(dto.ids, req.tattooArtist.id);
  }
}

@Controller('dashboard/images')
@UseGuards(SessionAuthGuard, TattooArtistGuard)
export class ArtistImagesController {
  constructor(@Inject(ImageManagementService) private readonly images: ImageManagementService) {}

  @Get(':id/download')
  download(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.images.artistDownload(req.tattooArtist.accountId!, id);
  }
}

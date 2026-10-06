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
import { CreateCaseDto, CreateStyleDto, UpdateCaseDto, UpdateStyleDto } from './calibration.dto.js';
import { CatalogService } from './catalog.service.js';
import { CatalogImportService } from './catalog-import.service.js';

@Controller('admin/catalog')
@UseGuards(SessionAuthGuard, AdminGuard)
export class CatalogController {
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(CatalogImportService) private readonly importer: CatalogImportService,
  ) {}

  @Post('import')
  importManifest(@Body() manifest: unknown) {
    return this.importer.import(manifest);
  }

  @Get('styles')
  listStyles() {
    return this.catalog.listStyles();
  }

  @Post('styles')
  createStyle(@Body() dto: CreateStyleDto) {
    return this.catalog.createStyle(dto);
  }

  @Patch('styles/:id')
  updateStyle(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateStyleDto,
  ) {
    return this.catalog.updateStyle(id, dto);
  }

  @Get('styles/:id/cases')
  listCases(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    return this.catalog.listCases(id);
  }

  @Post('styles/:id/cases')
  createCase(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: CreateCaseDto,
  ) {
    return this.catalog.createCase(id, dto);
  }

  @Patch('cases/:id')
  updateCase(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateCaseDto,
  ) {
    return this.catalog.updateCase(id, dto);
  }
}

import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { TattooArtistGuard } from '../auth/role.guard.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import {
  AdjustmentDto,
  CalibrationAnswerDto,
  CalibrationCatalogDto,
  EnableStyleDto,
  StartCalibrationDraftDto,
} from './calibration.dto.js';
import { CalibrationService } from './calibration.service.js';

@Controller('dashboard/calibration')
@UseGuards(SessionAuthGuard, TattooArtistGuard)
export class CalibrationController {
  constructor(@Inject(CalibrationService) private readonly calibration: CalibrationService) {}

  @Get('styles')
  listStyles(@Req() req: AuthenticatedRequest) {
    return this.calibration.listStyles(req.tattooArtist.accountId!);
  }

  @Patch('styles/:styleId')
  setStyle(
    @Req() req: AuthenticatedRequest,
    @Param('styleId', new ParseUUIDPipe({ version: '4' })) styleId: string,
    @Body() dto: EnableStyleDto,
  ) {
    return this.calibration.setStyle(req.tattooArtist.accountId!, styleId, dto.enabled);
  }

  @Get('styles/:styleId/draft')
  getDraft(
    @Req() req: AuthenticatedRequest,
    @Param('styleId', new ParseUUIDPipe({ version: '4' })) styleId: string,
  ) {
    return this.calibration.getDraft(req.tattooArtist.accountId!, styleId);
  }

  @Post('styles/:styleId/draft')
  startDraft(
    @Req() req: AuthenticatedRequest,
    @Param('styleId', new ParseUUIDPipe({ version: '4' })) styleId: string,
    @Body() dto: StartCalibrationDraftDto,
  ) {
    return this.calibration.startDraft(
      req.tattooArtist.accountId!,
      styleId,
      dto.catalog,
      dto.restart,
    );
  }

  @Get('styles/:styleId/cases')
  listCases(
    @Req() req: AuthenticatedRequest,
    @Param('styleId', new ParseUUIDPipe({ version: '4' })) styleId: string,
    @Query() dto: CalibrationCatalogDto,
  ) {
    return this.calibration.listCases(req.tattooArtist.accountId!, styleId, dto.catalog);
  }

  @Put('styles/:styleId/draft/answers/:caseId')
  saveAnswer(
    @Req() req: AuthenticatedRequest,
    @Param('styleId', new ParseUUIDPipe({ version: '4' })) styleId: string,
    @Param('caseId', new ParseUUIDPipe({ version: '4' })) caseId: string,
    @Body() dto: CalibrationAnswerDto,
  ) {
    return this.calibration.saveAnswer(req.tattooArtist.accountId!, styleId, caseId, dto.price);
  }

  @Post('styles/:styleId/draft/activate')
  activate(
    @Req() req: AuthenticatedRequest,
    @Param('styleId', new ParseUUIDPipe({ version: '4' })) styleId: string,
  ) {
    return this.calibration.activate(req.tattooArtist.accountId!, styleId);
  }

  @Get('models')
  listModels(@Req() req: AuthenticatedRequest) {
    return this.calibration.listModels(req.tattooArtist.accountId!);
  }

  @Get('adjustment')
  getAdjustment(@Req() req: AuthenticatedRequest) {
    return this.calibration.getAdjustment(req.tattooArtist.accountId!);
  }

  @Patch('adjustment')
  setAdjustment(@Req() req: AuthenticatedRequest, @Body() dto: AdjustmentDto) {
    return this.calibration.setAdjustment(req.tattooArtist.accountId!, dto.percent);
  }
}

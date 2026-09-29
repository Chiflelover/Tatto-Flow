import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { TattooArtistGuard } from '../auth/role.guard.js';
import { DashboardService } from './dashboard.service.js';
import {
  LeadListQueryDto,
  SaveManualFinalPriceDto,
  UpdatePricingRulesDto,
} from './dto/dashboard.dto.js';

@Controller('dashboard')
@UseGuards(SessionAuthGuard, TattooArtistGuard)
export class DashboardController {
  constructor(@Inject(DashboardService) private readonly dashboardService: DashboardService) {}

  @Get('metrics')
  getMetrics(@Req() request: AuthenticatedRequest) {
    return this.dashboardService.getMetrics(request.tattooArtist.accountId!);
  }

  @Get('leads')
  listLeads(@Query() query: LeadListQueryDto, @Req() request: AuthenticatedRequest) {
    return this.dashboardService.listLeads(request.tattooArtist.accountId!, query);
  }

  @Get('leads/:id')
  getLead(
    @Param('id', new ParseUUIDPipe({ version: '4' })) leadId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.dashboardService.getLead(request.tattooArtist.accountId!, leadId);
  }

  @Get('leads/:id/reference')
  getLeadReference(
    @Param('id', new ParseUUIDPipe({ version: '4' })) leadId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.dashboardService.getLeadReference(request.tattooArtist.accountId!, leadId);
  }

  @Patch('leads/:id/complete')
  completeLead(
    @Param('id', new ParseUUIDPipe({ version: '4' })) leadId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.dashboardService.completeLead(request.tattooArtist.accountId!, leadId);
  }

  @Patch('leads/:id/final-price')
  saveManualFinalPrice(
    @Param('id', new ParseUUIDPipe({ version: '4' })) leadId: string,
    @Body() dto: SaveManualFinalPriceDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.dashboardService.saveManualFinalPrice(
      request.tattooArtist.accountId!,
      leadId,
      dto.price,
    );
  }

  @Patch('leads/:id/archive')
  archiveLead(
    @Param('id', new ParseUUIDPipe({ version: '4' })) leadId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.dashboardService.archiveLead(request.tattooArtist.accountId!, leadId);
  }

  @Patch('leads/:id/restore')
  restoreLead(
    @Param('id', new ParseUUIDPipe({ version: '4' })) leadId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.dashboardService.restoreLead(request.tattooArtist.accountId!, leadId);
  }

  @Delete('leads/:id')
  deleteIncompleteLead(
    @Param('id', new ParseUUIDPipe({ version: '4' })) leadId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.dashboardService.deleteIncompleteLead(request.tattooArtist.accountId!, leadId);
  }

  @Get('pricing')
  getPricingRules(@Req() request: AuthenticatedRequest) {
    return this.dashboardService.getPricingRules(request.tattooArtist.accountId!);
  }

  @Patch('pricing')
  updatePricingRules(@Body() dto: UpdatePricingRulesDto, @Req() request: AuthenticatedRequest) {
    return this.dashboardService.updatePricingRules(
      request.tattooArtist.accountId!,
      dto.updates,
      request.tattooArtist.id,
    );
  }
}

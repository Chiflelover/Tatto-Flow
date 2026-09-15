import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { DashboardService } from './dashboard.service.js';
import {
  LeadListQueryDto,
  SaveManualPriceDto,
  UpdatePricingRulesDto,
} from './dto/dashboard.dto.js';

@Controller('dashboard')
@UseGuards(SessionAuthGuard)
export class DashboardController {
  constructor(@Inject(DashboardService) private readonly dashboardService: DashboardService) {}

  @Get('metrics')
  getMetrics() {
    return this.dashboardService.getMetrics();
  }

  @Get('leads')
  listLeads(@Query() query: LeadListQueryDto) {
    return this.dashboardService.listLeads(query.filter);
  }

  @Get('leads/:id')
  getLead(@Param('id', new ParseUUIDPipe({ version: '4' })) leadId: string) {
    return this.dashboardService.getLead(leadId);
  }

  @Get('leads/:id/reference')
  getLeadReference(@Param('id', new ParseUUIDPipe({ version: '4' })) leadId: string) {
    return this.dashboardService.getLeadReference(leadId);
  }

  @Patch('leads/:id/price')
  saveManualPrice(
    @Param('id', new ParseUUIDPipe({ version: '4' })) leadId: string,
    @Body() dto: SaveManualPriceDto,
  ) {
    return this.dashboardService.saveManualPrice(leadId, dto.minPrice, dto.maxPrice);
  }

  @Post('leads/:id/send-price')
  sendPrice(@Param('id', new ParseUUIDPipe({ version: '4' })) leadId: string) {
    return this.dashboardService.sendPrice(leadId);
  }

  @Patch('leads/:id/complete')
  completeLead(@Param('id', new ParseUUIDPipe({ version: '4' })) leadId: string) {
    return this.dashboardService.completeLead(leadId);
  }

  @Get('pricing')
  getPricingRules() {
    return this.dashboardService.getPricingRules();
  }

  @Patch('pricing')
  updatePricingRules(@Body() dto: UpdatePricingRulesDto, @Req() request: AuthenticatedRequest) {
    return this.dashboardService.updatePricingRules(dto.updates, request.tattooArtist.id);
  }
}

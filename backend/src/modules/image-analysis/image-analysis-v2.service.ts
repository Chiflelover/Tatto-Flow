import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { type Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { TattooImageInput } from './domain/image-analysis.types.js';
import { ImageAnalysisService, type ImageAnalysisContext } from './image-analysis.service.js';
import {
  IMAGE_ANALYSIS_V2_SCHEMA_VERSION,
  isEstimatedDensity,
  normalizeImageAnalysisV2Observation,
} from './image-analysis-v2.contract.js';
import { InvalidImageAnalysisResponseError } from './image-analysis-response.js';
import type { ImageAnalysisV2Result } from './domain/image-analysis-v2.types.js';

@Injectable()
export class ImageAnalysisV2Service {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ImageAnalysisService) private readonly provider: ImageAnalysisService,
  ) {}

  // Internal controlled entry point. It neither persists nor triggers the commercial workflow.
  async analyzeReference(image: TattooImageInput, context: ImageAnalysisContext = {}) {
    const styles = await this.prisma.tattooStyle.findMany({
      where: { isActive: true },
      select: { code: true, name: true },
      orderBy: { code: 'asc' },
    });
    const result = await this.provider.analyzeTattooImageV2(image, styles, context);
    this.validateDensity(result);
    return { ...result, observations: normalizeImageAnalysisV2Observation(result.observations) };
  }

  async analyzeAndPersistLeadReference(accountId: string, leadId: string, image: TattooImageInput) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, accountId },
      select: { aiAnalysis: true },
    });
    if (!lead) throw new NotFoundException('Lead no disponible para esta cuenta.');
    if (lead.aiAnalysis) {
      return lead.aiAnalysis;
    }
    const result = await this.analyzeReference(image, { leadId });
    return this.prisma.$transaction((tx) =>
      this.persistLeadReference(tx, accountId, leadId, result),
    );
  }

  async persistLeadReference(
    tx: Prisma.TransactionClient,
    accountId: string,
    leadId: string,
    result: ImageAnalysisV2Result,
  ) {
    this.validateDensity(result);
    const ownedLead = await tx.lead.findFirst({
      where: { id: leadId, accountId },
      select: { id: true },
    });
    if (!ownedLead) throw new ConflictException('El lead ya no admite un análisis V2.');
    const analysis = await tx.aiAnalysis.upsert({
      where: { leadId },
      update: {},
      create: {
        leadId,
        ...normalizeImageAnalysisV2Observation(result.observations),
        provider: result.provider,
        model: result.model,
        promptVersion: result.promptVersion,
        schemaVersion: result.schemaVersion,
        rawResponse: result.rawResponse,
      },
    });
    return analysis;
  }

  private validateDensity(result: ImageAnalysisV2Result) {
    const density = result.observations.estimatedDensity;
    if (
      (result.schemaVersion === IMAGE_ANALYSIS_V2_SCHEMA_VERSION || density !== null) &&
      !isEstimatedDensity(density)
    )
      throw new InvalidImageAnalysisResponseError();
  }
}

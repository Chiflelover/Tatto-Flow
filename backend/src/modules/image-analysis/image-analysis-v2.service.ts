import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AnalysisVersion, FlowVersion, type Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { TattooImageInput } from './domain/image-analysis.types.js';
import { ImageAnalysisService, type ImageAnalysisContext } from './image-analysis.service.js';
import { normalizeImageAnalysisV2Observation } from './image-analysis-v2.contract.js';
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
    return { ...result, observations: normalizeImageAnalysisV2Observation(result.observations) };
  }

  async analyzeAndPersistLeadReference(accountId: string, leadId: string, image: TattooImageInput) {
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, accountId },
      select: { conversation: { select: { flowVersion: true } }, aiAnalysis: true },
    });
    if (!lead) throw new NotFoundException('Lead no disponible para esta cuenta.');
    if (lead.conversation?.flowVersion !== FlowVersion.V2)
      throw new ConflictException('El análisis V2 solo se persiste para conversaciones V2.');
    if (lead.aiAnalysis) {
      if (lead.aiAnalysis.analysisVersion !== AnalysisVersion.V2)
        throw new ConflictException('El análisis histórico V1 debe conservarse.');
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
    const ownedLead = await tx.lead.findFirst({
      where: { id: leadId, accountId, conversation: { flowVersion: FlowVersion.V2 } },
      select: { id: true },
    });
    if (!ownedLead) throw new ConflictException('El lead ya no admite un análisis V2.');
    const analysis = await tx.aiAnalysis.upsert({
      where: { leadId },
      update: {},
      create: {
        leadId,
        analysisVersion: AnalysisVersion.V2,
        ...normalizeImageAnalysisV2Observation(result.observations),
        provider: result.provider,
        model: result.model,
        promptVersion: result.promptVersion,
        schemaVersion: result.schemaVersion,
        rawResponse: result.rawResponse,
      },
    });
    if (analysis.analysisVersion !== AnalysisVersion.V2)
      throw new ConflictException('El análisis histórico V1 debe conservarse.');
    return analysis;
  }
}

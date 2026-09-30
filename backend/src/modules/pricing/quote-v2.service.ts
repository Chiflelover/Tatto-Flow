import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Quote } from '../../generated/prisma/client.js';
import {
  ALGORITHM_VERSION,
  interpolatePrice,
  type ModelParameters,
} from '../calibration/model-interpolation.js';
import { v2PreparationFromJson } from '../chatbot/domain/nita-v2-decision.js';

export type QuoteV2Result =
  | { applicable: true; quote: Quote }
  | {
      applicable: false;
      reason: 'INVALID_PREPARATION' | 'PRICING_MODEL_NOT_AVAILABLE' | 'MODEL_NOT_APPLICABLE';
    };

@Injectable()
export class QuoteV2Service {
  // The caller holds the conversation lock; quote and outbound messages commit atomically.
  async getOrCreate(
    tx: Prisma.TransactionClient,
    accountId: string,
    leadId: string,
  ): Promise<QuoteV2Result> {
    const lead = await tx.lead.findFirst({
      where: { id: leadId, accountId },
      include: { quote: true, aiAnalysis: true, conversation: true },
    });
    if (!lead) throw new NotFoundException('Lead no disponible para esta cuenta.');
    if (lead.conversation?.flowVersion !== 'V2')
      throw new ConflictException('La cotización solo admite V2.');
    if (lead.quote) return { applicable: true, quote: lead.quote };
    const preparation = v2PreparationFromJson(lead.v2Preparation);
    if (
      preparation?.decision !== 'READY_FOR_PRICING' ||
      preparation.targetAreaCm2 === null ||
      preparation.targetColorCoverage === null ||
      !lead.aiAnalysis?.style
    )
      return { applicable: false, reason: 'INVALID_PREPARATION' };

    // Synchronize selection with calibration/adjustment changes without changing calibration.
    await tx.$queryRaw`SELECT id FROM tattoo_artist_accounts WHERE id = ${accountId}::uuid FOR SHARE`;
    const model = await tx.pricingModelVersion.findFirst({
      where: {
        accountId,
        status: 'ACTIVE',
        style: {
          code: lead.aiAnalysis.style,
          isActive: true,
          artistStyles: { some: { accountId, isEnabled: true } },
        },
      },
    });
    if (!model || !model.modelParameters)
      return { applicable: false, reason: 'PRICING_MODEL_NOT_AVAILABLE' };
    if (model.algorithmVersion !== ALGORITHM_VERSION)
      return { applicable: false, reason: 'MODEL_NOT_APPLICABLE' };
    let amount: Prisma.Decimal;
    let area: Prisma.Decimal;
    let color: Prisma.Decimal;
    try {
      area = new Prisma.Decimal(preparation.targetAreaCm2);
      color = new Prisma.Decimal(preparation.targetColorCoverage);
      if (!area.isFinite() || area.lte(0) || !color.isFinite() || color.lt(0) || color.gt(1))
        return { applicable: false, reason: 'INVALID_PREPARATION' };
      const result = interpolatePrice(
        model.modelParameters as unknown as ModelParameters,
        area,
        color,
        model.adjustmentPercent.toString(),
      );
      if (!result.applicable) return result;
      amount = new Prisma.Decimal(result.pricePen);
      if (!amount.isFinite() || amount.lte(0) || amount.gt('9999999999.99'))
        return { applicable: false, reason: 'MODEL_NOT_APPLICABLE' };
    } catch {
      return { applicable: false, reason: 'MODEL_NOT_APPLICABLE' };
    }
    const quote = await tx.quote.create({
      data: {
        leadId,
        accountId,
        pricingModelVersionId: model.id,
        amount,
        currency: 'PEN',
        targetAreaCm2: area,
        targetColorCoverage: color,
        detectedStyle: lead.aiAnalysis.style,
        generalAdjustmentPercent: model.adjustmentPercent,
        algorithmVersion: model.algorithmVersion,
        snapshot: {
          version: 1,
          analysisId: lead.aiAnalysis.id,
          detectedStyle: lead.aiAnalysis.style,
          targetAreaCm2: preparation.targetAreaCm2,
          targetColorCoverage: color.toString(),
          targetMainDimensionCm: preparation.targetMainDimensionCm,
          scaleFactor: preparation.scaleFactor,
          pricingModelVersionId: model.id,
          pricingModelVersion: model.version,
          algorithmVersion: model.algorithmVersion,
          generalAdjustmentPercent: model.adjustmentPercent.toString(),
          modelParameters: model.modelParameters,
          calibrationCases: model.caseSnapshot,
        },
      },
    });
    return { applicable: true, quote };
  }
}

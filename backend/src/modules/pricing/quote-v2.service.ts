import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Quote } from '../../generated/prisma/client.js';
import { CATALOG_AB_ALGORITHM_VERSION } from '../calibration/catalog-ab-interpolation.js';
import { calculateModelPrice } from '../calibration/pricing-model-dispatch.js';
import { v2PreparationFromJson } from '../chatbot/domain/nita-v2-decision.js';
import { declaredTargetColorCoverage } from '../chatbot/domain/nita-v2-color.js';

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
    if (lead.quote) return { applicable: true, quote: lead.quote };
    if (lead.aiAnalysis?.validTattooReference === false)
      return { applicable: false, reason: 'MODEL_NOT_APPLICABLE' };
    const preparation = v2PreparationFromJson(lead.v2Preparation);
    if (preparation?.decision !== 'READY_FOR_PRICING' || !lead.aiAnalysis?.style)
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
    const catalogAB = model.algorithmVersion === CATALOG_AB_ALGORITHM_VERSION;
    const declaredColor = declaredTargetColorCoverage(lead.colorDeclaration);
    if (declaredColor === null || declaredColor !== preparation.targetColorCoverage)
      return {
        applicable: false,
        reason: catalogAB ? 'MODEL_NOT_APPLICABLE' : 'INVALID_PREPARATION',
      };
    let amount: Prisma.Decimal;
    let area: Prisma.Decimal | null;
    let color: Prisma.Decimal;
    let calculation: Prisma.InputJsonObject | undefined;
    try {
      area =
        preparation.targetAreaCm2 === null ? null : new Prisma.Decimal(preparation.targetAreaCm2);
      color = new Prisma.Decimal(declaredColor);
      if (
        (!catalogAB && area === null) ||
        (area !== null && (!area.isFinite() || area.lte(0))) ||
        !color.isFinite() ||
        color.lt(0) ||
        color.gt(1)
      )
        return {
          applicable: false,
          reason: catalogAB ? 'MODEL_NOT_APPLICABLE' : 'INVALID_PREPARATION',
        };
      if (catalogAB && lead.aiAnalysis.validTattooReference !== true)
        return { applicable: false, reason: 'MODEL_NOT_APPLICABLE' };
      const result = calculateModelPrice(
        model.algorithmVersion,
        model.modelParameters,
        {
          styleId: model.styleId,
          styleCode: lead.aiAnalysis.style,
          areaCm2: area,
          targetSizeCm: lead.targetSizeCm,
          colorCoverage: color,
          estimatedDensity: lead.aiAnalysis.estimatedDensity,
        },
        model.adjustmentPercent.toString(),
      );
      if (!result.applicable) return result;
      calculation = result.calculation;
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
          version: catalogAB ? 2 : 1,
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
          colorDeclaration: lead.colorDeclaration,
          targetColorSource: 'CLIENT_DECLARATION',
          ...(catalogAB
            ? {
                targetSizeCm: lead.targetSizeCm,
                estimatedDensity: lead.aiAnalysis.estimatedDensity,
                validTattooReference: lead.aiAnalysis.validTattooReference,
                calculation,
              }
            : {}),
        },
      },
    });
    return { applicable: true, quote };
  }
}

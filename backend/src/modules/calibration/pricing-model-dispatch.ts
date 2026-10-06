import type { Prisma } from '../../generated/prisma/client.js';
import {
  ALGORITHM_VERSION,
  interpolatePrice,
  type ModelParameters,
} from './model-interpolation.js';
import {
  CATALOG_AB_ALGORITHM_VERSION,
  interpolateCatalogABPrice,
  type CatalogABModelParameters,
} from './catalog-ab-interpolation.js';

export interface PricingInputs {
  styleId: string;
  styleCode?: string;
  areaCm2?: Prisma.Decimal | number | null;
  targetSizeCm?: number | null;
  colorCoverage: Prisma.Decimal | number;
  estimatedDensity?: number | null;
}

export function calculateModelPrice(
  algorithmVersion: string,
  parameters: Prisma.JsonValue,
  inputs: PricingInputs,
  adjustmentPercent: string,
):
  | { applicable: false; reason: 'MODEL_NOT_APPLICABLE' }
  | { applicable: true; pricePen: string; calculation?: Prisma.InputJsonObject } {
  const unavailable = { applicable: false, reason: 'MODEL_NOT_APPLICABLE' } as const;
  try {
    if (algorithmVersion === ALGORITHM_VERSION) {
      if (inputs.areaCm2 == null) return unavailable;
      return interpolatePrice(
        parameters as unknown as ModelParameters,
        inputs.areaCm2,
        inputs.colorCoverage,
        adjustmentPercent,
      );
    }
    if (algorithmVersion === CATALOG_AB_ALGORITHM_VERSION) {
      const model = parameters as unknown as CatalogABModelParameters;
      if (
        model.styleId !== inputs.styleId ||
        (inputs.styleCode !== undefined && model.styleCode !== inputs.styleCode) ||
        typeof inputs.targetSizeCm !== 'number' ||
        !Number.isFinite(inputs.targetSizeCm) ||
        inputs.targetSizeCm <= 0 ||
        typeof inputs.estimatedDensity !== 'number' ||
        !Number.isFinite(inputs.estimatedDensity)
      )
        return unavailable;
      return interpolateCatalogABPrice(
        model,
        inputs.targetSizeCm,
        inputs.colorCoverage,
        inputs.estimatedDensity,
        adjustmentPercent,
      );
    }
  } catch {
    return unavailable;
  }
  return unavailable;
}

import { DetailLevel, TattooSize } from '../src/generated/prisma/client.js';
import { initialPricingRules } from './pricing-rules.seed-data.js';

describe('initialPricingRules', () => {
  it('contains the complete fixed pricing matrix', () => {
    expect(initialPricingRules).toEqual([
      { detail: DetailLevel.LIGHT, size: TattooSize.SMALL, minPrice: 70, maxPrice: 80 },
      { detail: DetailLevel.LIGHT, size: TattooSize.MEDIUM, minPrice: 250, maxPrice: 350 },
      { detail: DetailLevel.LIGHT, size: TattooSize.LARGE, minPrice: 800, maxPrice: 1100 },
      { detail: DetailLevel.MEDIUM, size: TattooSize.SMALL, minPrice: 90, maxPrice: 120 },
      { detail: DetailLevel.MEDIUM, size: TattooSize.MEDIUM, minPrice: 350, maxPrice: 500 },
      { detail: DetailLevel.MEDIUM, size: TattooSize.LARGE, minPrice: 1100, maxPrice: 1500 },
      { detail: DetailLevel.DETAILED, size: TattooSize.SMALL, minPrice: 120, maxPrice: 160 },
      { detail: DetailLevel.DETAILED, size: TattooSize.MEDIUM, minPrice: 500, maxPrice: 700 },
      { detail: DetailLevel.DETAILED, size: TattooSize.LARGE, minPrice: 1500, maxPrice: 2000 },
    ]);

    const combinations = new Set(initialPricingRules.map((rule) => `${rule.detail}:${rule.size}`));

    expect(combinations.size).toBe(initialPricingRules.length);
  });
});

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { SaveManualPriceDto, UpdatePricingRulesDto } from './dashboard.dto.js';

const RULE_ID = '00000000-0000-4000-8000-000000000001';

function validatePayload(payload: object) {
  return validate(plainToInstance(UpdatePricingRulesDto, payload), {
    forbidNonWhitelisted: true,
    whitelist: true,
  });
}

function validateManualPrice(payload: object) {
  return validate(plainToInstance(SaveManualPriceDto, payload), {
    forbidNonWhitelisted: true,
    whitelist: true,
  });
}

describe('SaveManualPriceDto', () => {
  it('accepts finite non-negative numeric prices', async () => {
    await expect(validateManualPrice({ minPrice: 420, maxPrice: 610 })).resolves.toHaveLength(0);
  });

  it.each([
    [{ maxPrice: 610 }],
    [{ minPrice: 420 }],
    [{ minPrice: '', maxPrice: 610 }],
    [{ minPrice: '420', maxPrice: 610 }],
    [{ minPrice: -1, maxPrice: 610 }],
  ])('rejects missing or invalid manual price input', async (payload) => {
    await expect(validateManualPrice(payload)).resolves.not.toHaveLength(0);
  });

  it('rejects attempts to set lead status or an automatic price through the manual DTO', async () => {
    const errors = await validateManualPrice({
      minPrice: 420,
      maxPrice: 610,
      status: 'VERIFIED',
      pricingRuleId: RULE_ID,
    });

    expect(errors.map(({ property }) => property)).toEqual(
      expect.arrayContaining(['status', 'pricingRuleId']),
    );
  });
});

describe('UpdatePricingRulesDto', () => {
  it('accepts only a rule identifier and valid min/max prices', async () => {
    await expect(
      validatePayload({
        updates: [{ pricingRuleId: RULE_ID, minPrice: 70, maxPrice: 80 }],
      }),
    ).resolves.toHaveLength(0);
  });

  it.each([
    ['', 80],
    ['not-a-number', 80],
    [-1, 80],
  ])('rejects empty, non-numeric or negative price fields', async (minPrice, maxPrice) => {
    const errors = await validatePayload({
      updates: [{ pricingRuleId: RULE_ID, minPrice, maxPrice }],
    });

    expect(errors).not.toHaveLength(0);
  });

  it('rejects attempts to modify size, detail, version or active state', async () => {
    const errors = await validatePayload({
      updates: [
        {
          pricingRuleId: RULE_ID,
          minPrice: 70,
          maxPrice: 80,
          size: 'LARGE',
          detail: 'DETAILED',
          version: 99,
          isActive: false,
        },
      ],
    });
    const nestedConstraints = errors[0]?.children?.[0]?.children ?? [];

    expect(nestedConstraints.map((error) => error.property)).toEqual(
      expect.arrayContaining(['size', 'detail', 'version', 'isActive']),
    );
  });
});

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { LeadListQueryDto, SaveManualFinalPriceDto } from './dashboard.dto.js';

function validateLeadQuery(payload: object) {
  return validate(plainToInstance(LeadListQueryDto, payload), {
    forbidNonWhitelisted: true,
    whitelist: true,
  });
}

function validateManualFinalPrice(payload: object) {
  return validate(plainToInstance(SaveManualFinalPriceDto, payload), {
    forbidNonWhitelisted: true,
    whitelist: true,
  });
}

describe('SaveManualFinalPriceDto', () => {
  it.each([650, 650.5, 650.55, 99_999_999.99])('accepts the valid price %s', async (price) => {
    await expect(validateManualFinalPrice({ price })).resolves.toHaveLength(0);
  });

  it.each([0, -1, 650.555, 100_000_000, Number.NaN, Number.POSITIVE_INFINITY, '650'])(
    'rejects the invalid price %s',
    async (price) => {
      await expect(validateManualFinalPrice({ price })).resolves.not.toHaveLength(0);
    },
  );

  it('rejects additional fields', async () => {
    await expect(
      validateManualFinalPrice({ price: 650, sendWhatsapp: true }),
    ).resolves.not.toHaveLength(0);
  });
});

describe('LeadListQueryDto', () => {
  it('accepts current status, archive, sorting, pagination and phone search', async () => {
    await expect(
      validateLeadQuery({
        status: 'REQUIRES_REVIEW',
        archived: 'true',
        sortBy: 'targetSizeCm',
        sortOrder: 'asc',
        page: '2',
        pageSize: '25',
        search: '+51999',
      }),
    ).resolves.toHaveLength(0);
  });

  it.each([
    [{ status: 'VERIFIED' }],
    [{ size: 'TINY' }],
    [{ detail: 'EXTREME' }],
    [{ archived: 'yes' }],
    [{ sortBy: 'city' }],
    [{ page: 0 }],
    [{ pageSize: 101 }],
    [{ search: '123456789012345678901' }],
  ])('rejects unsupported lead query values', async (payload) => {
    await expect(validateLeadQuery(payload)).resolves.not.toHaveLength(0);
  });
});

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PricingModelStatus, Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { CalibrationService } from './calibration.service.js';

const styleId = '00000000-0000-4000-8000-000000000010';
const accountA = '00000000-0000-4000-8000-000000000001';
const accountB = '00000000-0000-4000-8000-000000000002';
const cases = [
  {
    id: 'a',
    imageUrl: 'https://example.com/a.jpg',
    type: 'AREA',
    areaCm2: 10,
    colorCoverage: 0,
    displayOrder: 1,
  },
  {
    id: 'b',
    imageUrl: 'https://example.com/b.jpg',
    type: 'AREA',
    areaCm2: 100,
    colorCoverage: 0,
    displayOrder: 2,
  },
  {
    id: 'c',
    imageUrl: 'https://example.com/c.jpg',
    type: 'COLOR',
    areaCm2: 10,
    colorCoverage: 1,
    displayOrder: 3,
  },
  {
    id: 'd',
    imageUrl: 'https://example.com/d.jpg',
    type: 'COLOR',
    areaCm2: 100,
    colorCoverage: 0.5,
    displayOrder: 4,
  },
];
const answers = cases.map((item, index) => ({
  caseId: item.id,
  pricePen: new Prisma.Decimal(300 + index * 100),
}));

function mockDatabase() {
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: accountA }]),
    tattooArtistAccount: {
      findUnique: vi.fn().mockResolvedValue({
        id: accountA,
        isActive: true,
        adjustmentPercent: new Prisma.Decimal(0),
      }),
      update: vi.fn(),
    },
    artistStyle: {
      findUnique: vi.fn().mockResolvedValue({ isEnabled: true, style: { isActive: true } }),
    },
    pricingModelVersion: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    calibrationCase: { findMany: vi.fn() },
    calibrationAnswer: { upsert: vi.fn() },
  };
  const prisma = {
    $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    tattooStyle: {
      findUnique: vi.fn().mockResolvedValue({ id: styleId, isActive: true }),
      findMany: vi.fn(),
    },
    artistStyle: { upsert: vi.fn() },
    tattooArtistAccount: { findUniqueOrThrow: vi.fn() },
    pricingModelVersion: { findFirst: vi.fn(), findMany: vi.fn() },
  };
  return { tx, prisma, service: new CalibrationService(prisma as unknown as PrismaService) };
}

describe('CalibrationService', () => {
  it('enables and disables styles only for the authenticated account', async () => {
    const { prisma, service } = mockDatabase();
    await service.setStyle(accountA, styleId, true);
    await service.setStyle(accountA, styleId, false);
    expect(prisma.artistStyle.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { accountId_styleId: { accountId: accountA, styleId } },
        create: { accountId: accountA, styleId, isEnabled: true },
      }),
    );
    expect(prisma.artistStyle.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        update: { isEnabled: false },
      }),
    );
  });

  it('does not return another account draft or model', async () => {
    const { prisma, service } = mockDatabase();
    prisma.pricingModelVersion.findFirst.mockImplementation(({ where }) =>
      where.accountId === accountB ? { id: 'B' } : null,
    );
    expect(await service.getDraft(accountA, styleId)).toBeNull();
    expect(await service.calculatePrice(accountA, styleId, 10, 0)).toEqual({
      applicable: false,
      reason: 'NO_ACTIVE_MODEL',
    });
    expect(prisma.pricingModelVersion.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ accountId: accountA, styleId }) }),
    );
  });

  it('does not reinterpret a historical IDW model as the separable algorithm', async () => {
    const { prisma, service } = mockDatabase();
    prisma.pricingModelVersion.findFirst.mockResolvedValue({
      id: 'legacy-idw',
      algorithmVersion: 'IDW_CONVEX_HULL_V1',
      modelParameters: { algorithm: 'IDW_CONVEX_HULL_V1', points: [] },
    });
    await expect(service.calculatePrice(accountA, styleId, 50, 0.25)).resolves.toEqual({
      applicable: false,
      reason: 'MODEL_NOT_APPLICABLE',
      modelVersionId: 'legacy-idw',
    });
  });

  it('freezes the active case set for a new draft and scopes it to the account', async () => {
    const { tx, prisma, service } = mockDatabase();
    tx.pricingModelVersion.findFirst.mockResolvedValue(null);
    tx.calibrationCase.findMany.mockResolvedValue(
      cases.map((item) => ({
        ...item,
        areaCm2: new Prisma.Decimal(item.areaCm2),
        colorCoverage: new Prisma.Decimal(item.colorCoverage),
      })),
    );
    tx.pricingModelVersion.create.mockResolvedValue({ id: 'draft' });
    prisma.pricingModelVersion.findFirst.mockResolvedValue({
      id: 'draft',
      version: 1,
      caseSnapshot: cases,
      answers: [],
      style: { name: 'Fine Line' },
    });
    const draft = await service.startDraft(accountA, styleId);
    expect(draft?.totalCount).toBe(4);
    expect(tx.pricingModelVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ accountId: accountA, styleId, caseSnapshot: cases }),
    });
  });

  it('rejects nonpositive prices and upserts one answer per case/version', async () => {
    const { tx, prisma, service } = mockDatabase();
    await expect(service.saveAnswer(accountA, styleId, 'a', 0)).rejects.toBeInstanceOf(
      ConflictException,
    );
    tx.pricingModelVersion.findFirst.mockResolvedValue({ id: 'draft', caseSnapshot: cases });
    prisma.pricingModelVersion.findFirst.mockResolvedValue({
      id: 'draft',
      version: 1,
      caseSnapshot: cases,
      answers: [],
      style: { name: 'Fine Line' },
    });
    await service.saveAnswer(accountA, styleId, 'a', 347);
    await service.saveAnswer(accountA, styleId, 'a', 350);
    expect(tx.calibrationAnswer.upsert).toHaveBeenNthCalledWith(2, {
      where: { modelVersionId_caseId: { modelVersionId: 'draft', caseId: 'a' } },
      create: { modelVersionId: 'draft', caseId: 'a', pricePen: 350 },
      update: { pricePen: 350 },
    });
    await expect(service.saveAnswer(accountA, styleId, 'foreign', 500)).rejects.toThrow();
  });

  it('activates a completed recalibration and supersedes only its prior active model', async () => {
    const { tx, service } = mockDatabase();
    const draft = { id: 'draft', version: 2, caseSnapshot: cases, answers };
    const active = { id: 'previous', version: 1 };
    tx.pricingModelVersion.findFirst.mockImplementation(({ where, orderBy }) => {
      if (orderBy) return draft;
      return where.status === PricingModelStatus.DRAFT ? draft : active;
    });
    tx.pricingModelVersion.update.mockImplementation(({ where, data }) => ({
      id: where.id,
      accountId: accountA,
      styleId,
      version: data.version ?? 1,
      status: data.status,
      adjustmentPercent: new Prisma.Decimal(0),
      sourceVersionId: data.sourceVersionId ?? null,
      createdAt: new Date(),
      activatedAt: data.activatedAt ?? null,
    }));
    const result = await service.activate(accountA, styleId);
    expect(result.status).toBe(PricingModelStatus.ACTIVE);
    expect(result.version).toBe(2);
    expect(tx.pricingModelVersion.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'previous' },
      data: { status: PricingModelStatus.SUPERSEDED },
    });
    expect(tx.pricingModelVersion.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { id: 'draft' },
        data: expect.objectContaining({
          sourceVersionId: 'previous',
          algorithmVersion: 'AREA_COLOR_SEPARABLE_V1',
          modelParameters: expect.objectContaining({ algorithmVersion: 'AREA_COLOR_SEPARABLE_V1' }),
        }),
      }),
    );
  });

  it('creates a new active version for a general adjustment and keeps the prior parameters and answers', async () => {
    const { tx, service } = mockDatabase();
    const previous = {
      id: 'old',
      accountId: accountA,
      styleId,
      version: 1,
      status: PricingModelStatus.ACTIVE,
      caseSnapshot: cases,
      algorithmVersion: 'AREA_COLOR_SEPARABLE_V1',
      modelParameters: {
        algorithmVersion: 'AREA_COLOR_SEPARABLE_V1',
        areaCurve: [],
        colorCurve: [],
      },
      answers,
    };
    tx.pricingModelVersion.findMany.mockResolvedValue([previous]);
    tx.pricingModelVersion.findFirst.mockResolvedValue(previous);
    const result = await service.setAdjustment(accountA, 10);
    expect(result).toEqual({ percent: '10.00', newVersions: 1 });
    expect(tx.pricingModelVersion.update).toHaveBeenCalledWith({
      where: { id: 'old' },
      data: { status: PricingModelStatus.SUPERSEDED },
    });
    expect(tx.pricingModelVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: accountA,
        styleId,
        version: 2,
        status: PricingModelStatus.ACTIVE,
        adjustmentPercent: 10,
        sourceVersionId: 'old',
        modelParameters: previous.modelParameters,
        algorithmVersion: 'AREA_COLOR_SEPARABLE_V1',
        answers: {
          create: answers.map((answer) => ({ caseId: answer.caseId, pricePen: answer.pricePen })),
        },
      }),
    });
    expect(tx.tattooArtistAccount.update).toHaveBeenCalledTimes(1);
  });
});

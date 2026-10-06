/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PricingModelStatus, Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { CalibrationService } from './calibration.service.js';
import { CATALOG_AB_ALGORITHM_VERSION } from './catalog-ab-interpolation.js';
import { catalogABPricingFixture } from '../../../test/fixtures/catalog-ab-pricing.js';

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
    artistStyle: { upsert: vi.fn(), findUnique: tx.artistStyle.findUnique },
    calibrationCase: tx.calibrationCase,
    tattooArtistAccount: { findUniqueOrThrow: vi.fn() },
    pricingModelVersion: { findFirst: vi.fn(), findMany: vi.fn() },
  };
  return { tx, prisma, service: new CalibrationService(prisma as unknown as PrismaService) };
}

describe('CalibrationService', () => {
  function fineLineDatabase() {
    const f = mockDatabase();
    f.tx.artistStyle.findUnique.mockResolvedValue({
      isEnabled: true,
      style: { id: styleId, code: 'FINE_LINE', isActive: true },
    });
    const points = catalogABPricingFixture(styleId);
    f.tx.calibrationCase.findMany.mockResolvedValue(points);
    f.tx.pricingModelVersion.create.mockResolvedValue({ id: 'new-draft' });
    f.prisma.pricingModelVersion.findFirst.mockResolvedValue({
      id: 'new-draft',
      version: 1,
      caseSnapshot: points,
      answers: [],
      style: { name: 'Fine Line', code: 'FINE_LINE' },
    });
    return { ...f, points };
  }

  it('counts only the A/B references for Fine Line while preserving other style catalogs', async () => {
    const { prisma, service } = mockDatabase();
    prisma.tattooStyle.findMany.mockResolvedValue([
      {
        id: styleId,
        code: 'FINE_LINE',
        name: 'Fine Line',
        artistStyles: [],
        modelVersions: [],
        cases: [
          ...Array.from({ length: 9 }, () => ({ phase: null })),
          ...catalogABPricingFixture(),
        ],
      },
      {
        id: 'blackwork',
        code: 'BLACKWORK',
        name: 'Blackwork',
        artistStyles: [],
        modelVersions: [],
        cases: [{ phase: null }],
      },
    ]);
    const styles = await service.listStyles(accountA);
    expect(styles[0]).toMatchObject({ caseCount: 0, catalogCaseCount: 25 });
    expect(styles[1]).toMatchObject({ caseCount: 1, catalogCaseCount: 0 });
  });

  it('selects A/B for Fine Line even when the request omits the catalog or asks for AREA_COLOR', async () => {
    const { tx, service } = fineLineDatabase();
    tx.pricingModelVersion.findFirst.mockResolvedValue(null);
    for (const catalog of [undefined, 'AREA_COLOR'] as const) {
      expect(await service.startDraft(accountA, styleId, catalog)).toMatchObject({
        totalCount: 25,
        answeredCount: 0,
        catalogFormat: 'PHASED',
      });
    }
    expect(tx.calibrationCase.findMany).toHaveBeenCalledWith({
      where: { styleId, isActive: true, phase: { not: null } },
      orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
    });
    expect(tx.pricingModelVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ algorithmVersion: 'CATALOG_AB_PENDING' }),
    });
    expect(await service.listCases(accountA, styleId)).toHaveLength(25);
  });

  it('archives an obsolete Fine Line draft and starts a fresh A/B version without changing the active model', async () => {
    const { tx, service } = fineLineDatabase();
    const existing = { id: 'old-draft', version: 3, caseSnapshot: cases, answers };
    tx.pricingModelVersion.findFirst.mockImplementation(({ where, orderBy }) =>
      orderBy ? existing : where.status === 'DRAFT' ? existing : { id: 'active-ab', version: 2 },
    );
    const next = await service.startDraft(accountA, styleId);
    expect(next).toMatchObject({ totalCount: 25, answeredCount: 0 });
    expect(next!.cases.every((item) => item.pricePen === null)).toBe(true);
    expect(tx.pricingModelVersion.update).toHaveBeenCalledExactlyOnceWith({
      where: { id: existing.id },
      data: { status: 'SUPERSEDED' },
    });
    expect(tx.pricingModelVersion.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: accountA,
        styleId,
        version: 4,
        sourceVersionId: 'active-ab',
        algorithmVersion: 'CATALOG_AB_PENDING',
      }),
    });
    expect(tx.pricingModelVersion.create.mock.calls[0][0].data.answers).toBeUndefined();
  });

  it('recalibrates A/B from zero while reopening the existing draft preserves its answers', async () => {
    const { tx, prisma, service, points } = fineLineDatabase();
    const existing = {
      id: 'partial',
      version: 3,
      algorithmVersion: 'CATALOG_AB_PENDING',
      caseSnapshot: points,
      answers: [{ caseId: points[0].id, pricePen: new Prisma.Decimal(123) }],
      style: { name: 'Fine Line', code: 'FINE_LINE' },
    };
    tx.pricingModelVersion.findFirst.mockImplementation(({ where, orderBy }) =>
      orderBy ? existing : where.status === 'DRAFT' ? existing : { id: 'active', version: 2 },
    );
    prisma.pricingModelVersion.findFirst.mockResolvedValueOnce(existing);
    expect(await service.startDraft(accountA, styleId, 'PHASED')).toMatchObject({
      id: existing.id,
      answeredCount: 1,
    });
    expect(tx.pricingModelVersion.create).not.toHaveBeenCalled();
    expect(await service.startDraft(accountA, styleId, 'PHASED', true)).toMatchObject({
      id: 'new-draft',
      totalCount: 25,
      answeredCount: 0,
    });
    expect(tx.pricingModelVersion.update).toHaveBeenCalledExactlyOnceWith({
      where: { id: existing.id },
      data: { status: 'SUPERSEDED' },
    });
  });

  it('does not discard a previous draft when no current A/B catalog is available', async () => {
    const { tx, service } = fineLineDatabase();
    tx.pricingModelVersion.findFirst.mockResolvedValue({ id: 'old-draft', caseSnapshot: cases });
    tx.calibrationCase.findMany.mockResolvedValue([]);
    await expect(service.startDraft(accountA, styleId)).rejects.toThrow(/no hay imágenes/);
    expect(tx.pricingModelVersion.update).not.toHaveBeenCalled();
    expect(tx.pricingModelVersion.create).not.toHaveBeenCalled();
  });

  it('never exposes, prices or activates a retired Fine Line draft', async () => {
    const { tx, prisma, service } = fineLineDatabase();
    const obsolete = { id: 'old', caseSnapshot: cases, answers, style: { code: 'FINE_LINE' } };
    prisma.pricingModelVersion.findFirst.mockResolvedValue(obsolete);
    tx.pricingModelVersion.findFirst.mockResolvedValue(obsolete);
    expect(await service.getDraft(accountA, styleId)).toBeNull();
    await expect(service.saveAnswer(accountA, styleId, 'a', 100)).rejects.toThrow(
      /referencias actuales/,
    );
    await expect(service.activate(accountA, styleId)).rejects.toThrow(/referencias actuales/);
    expect(tx.calibrationAnswer.upsert).not.toHaveBeenCalled();
    expect(tx.pricingModelVersion.update).not.toHaveBeenCalled();
  });

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

  it('keeps incomplete A/B drafts pending without falling back to AREA/COLOR pricing', async () => {
    const { tx, service } = mockDatabase();
    tx.pricingModelVersion.findFirst.mockResolvedValue({
      id: 'phased',
      caseSnapshot: [{ id: 'case-a', phase: 'A', density: 34.5 }],
      answers: [],
    });
    await expect(service.activate(accountA, styleId)).rejects.toThrow(/Responde todos los casos/);
    expect(tx.pricingModelVersion.update).not.toHaveBeenCalled();
    expect(tx.pricingModelVersion.create).not.toHaveBeenCalled();
  });

  it('rejects switching catalog formats while retaining an existing draft', async () => {
    const { tx, service } = mockDatabase();
    tx.pricingModelVersion.findFirst.mockResolvedValue({
      id: 'current-draft',
      caseSnapshot: cases,
    });
    await expect(service.startDraft(accountA, styleId, 'PHASED')).rejects.toThrow(/otro catálogo/);
    expect(tx.pricingModelVersion.create).not.toHaveBeenCalled();
  });

  it('materializes a completed pending A/B draft when calibration is reopened', async () => {
    const { tx, prisma, service } = mockDatabase();
    const points = catalogABPricingFixture(styleId);
    const draft = {
      id: 'completed-pending',
      version: 2,
      algorithmVersion: 'CATALOG_AB_PENDING',
      caseSnapshot: points,
      answers: points.map((point) => ({
        caseId: point.id,
        pricePen: new Prisma.Decimal(point.pricePen),
      })),
      style: { name: 'Fine Line' },
    };
    tx.pricingModelVersion.findFirst.mockResolvedValue(draft);
    prisma.pricingModelVersion.findFirst.mockResolvedValue(draft);
    expect(await service.startDraft(accountA, styleId, 'PHASED')).toMatchObject({
      id: draft.id,
      answeredCount: 25,
      canActivate: true,
    });
    expect(tx.pricingModelVersion.update).toHaveBeenCalledWith({
      where: { id: draft.id },
      data: {
        algorithmVersion: CATALOG_AB_ALGORITHM_VERSION,
        modelParameters: expect.objectContaining({
          styleId,
          baseSurface: expect.any(Array),
          densityCurve: expect.any(Array),
        }),
      },
    });
    expect(tx.pricingModelVersion.create).not.toHaveBeenCalled();
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

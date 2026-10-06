import { describe, expect, it, vi } from 'vitest';
import { Prisma, type CalibrationCase } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { catalogManifestFixture } from '../../../test/fixtures/calibration-catalog.js';
import { CatalogImportService } from './catalog-import.service.js';

function fixture(existing: CalibrationCase[] = []) {
  const tx = {
    $queryRaw: vi.fn(),
    tattooStyle: { findMany: vi.fn().mockResolvedValue([{ id: 'style', code: 'TEST_STYLE' }]) },
    calibrationCase: {
      findMany: vi.fn().mockResolvedValue(existing),
      createMany: vi.fn(),
      update: vi.fn(),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { tx, service: new CatalogImportService(prisma as unknown as PrismaService) };
}

describe('global catalog import', () => {
  it('validates the entire graph before persisting and inserts parents first', async () => {
    const { tx, service } = fixture();
    await expect(service.import(catalogManifestFixture())).resolves.toMatchObject({
      changedCount: 3,
    });
    expect(tx.calibrationCase.createMany).toHaveBeenNthCalledWith(1, {
      data: [expect.objectContaining({ phase: 'A' }), expect.objectContaining({ phase: 'A' })],
    });
    expect(tx.calibrationCase.createMany).toHaveBeenNthCalledWith(2, {
      data: [expect.objectContaining({ phase: 'B' })],
    });
    expect(tx.calibrationCase.update).not.toHaveBeenCalled();
    expect(tx.calibrationCase.findMany).toHaveBeenCalledWith({ where: { phase: { not: null } } });
  });

  it.each(['size', 'color', 'metadata', 'parent'])(
    'rejects mismatched B %s without writes',
    async (field) => {
      const manifest = catalogManifestFixture();
      if (field === 'size') manifest.cases[0].sizeCm += 1;
      if (field === 'color') manifest.cases[0].color.coverage = 0.5;
      if (field === 'metadata') manifest.cases[0].color.metadata.label = 'different';
      if (field === 'parent') manifest.cases[0].baseCaseId = 'MISSING_A';
      const { tx, service } = fixture();
      await expect(service.import(manifest)).rejects.toThrow(/conservar estilo, tamaño y color/);
      expect(tx.calibrationCase.createMany).not.toHaveBeenCalled();
      expect(tx.calibrationCase.update).not.toHaveBeenCalled();
    },
  );

  it('rejects unknown styles without persisting any cases', async () => {
    const { tx, service } = fixture();
    tx.tattooStyle.findMany.mockResolvedValue([]);
    await expect(service.import(catalogManifestFixture())).rejects.toThrow(/Estilo desconocido/);
    expect(tx.calibrationCase.createMany).not.toHaveBeenCalled();
    expect(tx.calibrationCase.update).not.toHaveBeenCalled();
  });

  it('rejects filenames already owned by an omitted global case', async () => {
    const { tx, service } = fixture([
      {
        id: 'other',
        caseKey: 'OTHER_A',
        phase: 'A',
        styleId: 'style',
        imageKey: 'test_b_001.PNG',
        sizeCm: 10.5,
        colorCoverage: new Prisma.Decimal(0.25),
        colorMetadata: {},
        baseCaseKey: null,
      } as CalibrationCase,
    ]);
    await expect(service.import(catalogManifestFixture())).rejects.toThrow(/ya pertenece/);
    expect(tx.calibrationCase.createMany).not.toHaveBeenCalled();
    expect(tx.calibrationCase.update).not.toHaveBeenCalled();
  });
});

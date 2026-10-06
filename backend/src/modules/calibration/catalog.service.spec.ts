import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { CreateCaseDto } from './calibration.dto.js';
import { CatalogService } from './catalog.service.js';

describe('CatalogService', () => {
  it('rejects recreating AREA/COLOR cases for Fine Line', async () => {
    const create = vi.fn();
    const service = new CatalogService({
      tattooStyle: { findUnique: vi.fn().mockResolvedValue({ code: 'FINE_LINE' }) },
      calibrationCase: { create },
    } as unknown as PrismaService);
    await expect(
      service.createCase('fine-line', {
        imageUrl: 'https://example.com/old.png',
        type: 'AREA',
        areaCm2: 25,
        colorCoverage: 0,
        displayOrder: 1,
      }),
    ).rejects.toThrow(/catálogo A\/B/);
    expect(create).not.toHaveBeenCalled();
  });

  it('accepts a new stable style code without changing a Prisma enum', async () => {
    const create = vi.fn().mockResolvedValue({ code: 'MICRO_REALISM', name: 'Micro Realism' });
    const service = new CatalogService({ tattooStyle: { create } } as unknown as PrismaService);
    await expect(
      service.createStyle({ code: 'MICRO_REALISM', name: ' Micro Realism ' }),
    ).resolves.toEqual({
      code: 'MICRO_REALISM',
      name: 'Micro Realism',
    });
    expect(create).toHaveBeenCalledWith({ data: { code: 'MICRO_REALISM', name: 'Micro Realism' } });
  });

  it('can deactivate a case without deleting it or its historical answers', async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 'case-1' });
    const update = vi.fn().mockResolvedValue({ id: 'case-1', isActive: false });
    const service = new CatalogService({
      calibrationCase: { findUnique, update },
    } as unknown as PrismaService);
    await service.updateCase('case-1', { isActive: false });
    expect(update).toHaveBeenCalledWith({ where: { id: 'case-1' }, data: { isActive: false } });
  });

  it('accepts color coverage from zero to one and rejects values outside that interval', () => {
    const input = {
      imageUrl: 'https://example.com/permanent-reference.jpg',
      type: 'COLOR',
      areaCm2: 40,
      colorCoverage: 0.5,
      displayOrder: 1,
    };
    expect(validateSync(plainToInstance(CreateCaseDto, input))).toHaveLength(0);
    for (const colorCoverage of [-0.01, 1.01]) {
      expect(
        validateSync(plainToInstance(CreateCaseDto, { ...input, colorCoverage })).length,
      ).toBeGreaterThan(0);
    }
  });

  it('requires a versioned manifest to edit A/B metadata but allows deactivation', async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 'case-1', phase: 'A' });
    const update = vi.fn();
    const service = new CatalogService({
      calibrationCase: { findUnique, update },
    } as unknown as PrismaService);
    await expect(service.updateCase('case-1', { areaCm2: 20 })).rejects.toThrow(/manifest/);
    expect(update).not.toHaveBeenCalled();
    await service.updateCase('case-1', { isActive: false });
    expect(update).toHaveBeenCalledWith({ where: { id: 'case-1' }, data: { isActive: false } });
  });
});

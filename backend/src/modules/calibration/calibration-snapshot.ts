import { ConflictException } from '@nestjs/common';
import type { CalibrationCase, Prisma } from '../../generated/prisma/client.js';

export type CalibrationCatalog = 'AREA_COLOR' | 'PHASED';

export interface AreaColorSnapshot {
  id: string;
  imageUrl: string;
  type: 'AREA' | 'COLOR';
  areaCm2: number;
  colorCoverage: number;
  displayOrder: number;
}

export interface PhasedCaseSnapshot {
  id: string;
  caseKey: string;
  styleId: string;
  styleCode: string;
  phase: 'A' | 'B';
  imageUrl: string;
  imageKey: string;
  sizeCm: number;
  colorCoverage: number;
  colorMetadata: Prisma.JsonValue;
  density: number;
  densityMetadata: Prisma.JsonValue;
  catalogVersion: string;
  baseCaseKey: string | null;
  displayOrder: number;
  isActive: boolean;
}

export type CaseSnapshot = AreaColorSnapshot | PhasedCaseSnapshot;

export function readCaseSnapshot(value: Prisma.JsonValue): CaseSnapshot[] {
  return value as unknown as CaseSnapshot[];
}

export function snapshotCatalog(cases: CaseSnapshot[]): CalibrationCatalog {
  return cases.some((item) => 'phase' in item) ? 'PHASED' : 'AREA_COLOR';
}

export function freezeCase(item: CalibrationCase, styleCode: string): CaseSnapshot {
  if (!item.phase) {
    if (!item.type || item.areaCm2 === null)
      throw new ConflictException('Caso AREA/COLOR incompleto.');
    return {
      id: item.id,
      imageUrl: item.imageUrl,
      type: item.type,
      areaCm2: Number(item.areaCm2),
      colorCoverage: Number(item.colorCoverage),
      displayOrder: item.displayOrder,
    };
  }
  if (
    !item.caseKey ||
    !item.imageKey ||
    item.sizeCm === null ||
    item.density === null ||
    !item.catalogVersion ||
    item.colorMetadata === null ||
    item.densityMetadata === null
  )
    throw new ConflictException('Caso de catálogo A/B incompleto.');
  return {
    id: item.id,
    caseKey: item.caseKey,
    styleId: item.styleId,
    styleCode,
    phase: item.phase,
    imageUrl: item.imageUrl,
    imageKey: item.imageKey,
    sizeCm: item.sizeCm,
    colorCoverage: Number(item.colorCoverage),
    colorMetadata: item.colorMetadata,
    density: item.density,
    densityMetadata: item.densityMetadata,
    catalogVersion: item.catalogVersion,
    baseCaseKey: item.baseCaseKey,
    displayOrder: item.displayOrder,
    isActive: item.isActive,
  };
}

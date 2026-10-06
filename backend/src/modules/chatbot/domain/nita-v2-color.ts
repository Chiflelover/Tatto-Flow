import { ColorDeclaration } from '../../../generated/prisma/client.js';

const TARGET_COLOR_COVERAGE = {
  [ColorDeclaration.BLACK_ONLY]: 0,
  [ColorDeclaration.LOW_COLOR]: 0.25,
  [ColorDeclaration.MEDIUM_COLOR]: 0.5,
  [ColorDeclaration.FULL_COLOR]: 1,
} as const;

export type ExplicitColorDeclaration = keyof typeof TARGET_COLOR_COVERAGE;

export function isExplicitColorDeclaration(value: unknown): value is ExplicitColorDeclaration {
  return typeof value === 'string' && Object.hasOwn(TARGET_COLOR_COVERAGE, value);
}

export function declaredTargetColorCoverage(value: ColorDeclaration | null): number | null {
  return isExplicitColorDeclaration(value) ? TARGET_COLOR_COVERAGE[value] : null;
}

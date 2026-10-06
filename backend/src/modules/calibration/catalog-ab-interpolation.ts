import { Prisma } from '../../generated/prisma/client.js';
import type { PhasedCaseSnapshot } from './calibration-snapshot.js';

export const CATALOG_AB_ALGORITHM_VERSION = 'CATALOG_AB_BILINEAR_DENSITY_V1' as const;
const Decimal = Prisma.Decimal.clone({ precision: 40 });
type DecimalInput = number | string | Prisma.Decimal;

export interface CatalogABPoint extends PhasedCaseSnapshot {
  pricePen: string;
}

export interface CatalogABModelParameters {
  algorithmVersion: typeof CATALOG_AB_ALGORITHM_VERSION;
  styleId: string;
  styleCode: string;
  catalogVersion: string;
  anchorDensity: 60;
  sizeKnots: number[];
  colorKnots: number[];
  baseSurface: {
    caseId: string;
    caseKey: string;
    sizeCm: number;
    colorCoverage: number;
    pricePen: string;
  }[];
  densityReference: {
    baseCaseId: string;
    baseCaseKey: string;
    sizeCm: number;
    colorCoverage: number;
    anchorCaseId: string;
    anchorPricePen: string;
  };
  densityCurve: { caseId: string; caseKey: string; density: number; pricePen: string }[];
}

export type CatalogABPriceResult =
  | { applicable: false; reason: 'MODEL_NOT_APPLICABLE' }
  | {
      applicable: true;
      pricePen: string;
      calculation: {
        basePricePen: string;
        densityPricePen: string;
        densityAnchorPricePen: string;
        densityFactor: string;
        adjustmentFactor: string;
        unadjustedPricePen: string;
      };
    };

export function buildCatalogABModel(points: CatalogABPoint[]): CatalogABModelParameters {
  const a = points.filter((point) => point.phase === 'A');
  const b = points.filter((point) => point.phase === 'B');
  if (points.length !== 25 || a.length !== 20 || b.length !== 5)
    throw new Error('El catálogo necesita 20 referencias de tamaño/color y 5 de densidad.');
  const first = a[0];
  if (
    points.some(
      (point) =>
        !point.id ||
        !point.caseKey ||
        !point.styleId ||
        !point.styleCode ||
        !point.catalogVersion ||
        point.styleId !== first.styleId ||
        point.styleCode !== first.styleCode ||
        point.catalogVersion !== first.catalogVersion ||
        !Number.isFinite(point.sizeCm) ||
        point.sizeCm <= 0 ||
        !Number.isFinite(point.colorCoverage) ||
        point.colorCoverage < 0 ||
        point.colorCoverage > 1 ||
        !Number.isFinite(point.density) ||
        point.density < 0 ||
        point.density > 100 ||
        !new Decimal(point.pricePen).isFinite() ||
        new Decimal(point.pricePen).lte(0),
    ) ||
    new Set(points.map((point) => point.id)).size !== 25 ||
    new Set(points.map((point) => point.caseKey)).size !== 25
  )
    throw new Error(
      'Las referencias y sus precios deben pertenecer a un único estilo y catálogo válido.',
    );
  const sizes = [...new Set(a.map((point) => point.sizeCm))].sort((x, y) => x - y);
  const colors = [...new Set(a.map((point) => point.colorCoverage))].sort((x, y) => x - y);
  if (
    sizes.length !== 5 ||
    colors.length !== 4 ||
    a.some((point) => point.density !== 60 || point.baseCaseKey !== null) ||
    new Set(a.map((point) => `${point.sizeCm}:${point.colorCoverage}`)).size !== 20
  )
    throw new Error(
      'La superficie debe contener las 20 combinaciones de 5 tamaños y 4 coberturas, con densidad 60.',
    );
  const base = a.find((point) => point.caseKey === b[0].baseCaseKey);
  const curve = [...b].sort((x, y) => x.density - y.density);
  if (
    !base ||
    curve.some(
      (point, index) =>
        point.density !== [20, 40, 60, 80, 100][index] ||
        point.baseCaseKey !== base.caseKey ||
        point.sizeCm !== base.sizeCm ||
        point.colorCoverage !== base.colorCoverage ||
        point.colorCoverage !== 0,
    )
  )
    throw new Error(
      'Las 5 referencias de densidad deben compartir su referencia base y variar únicamente entre 20, 40, 60, 80 y 100.',
    );
  const center = curve[2];
  return {
    algorithmVersion: CATALOG_AB_ALGORITHM_VERSION,
    styleId: first.styleId,
    styleCode: first.styleCode,
    catalogVersion: first.catalogVersion,
    anchorDensity: 60,
    sizeKnots: sizes,
    colorKnots: colors,
    baseSurface: [...a]
      .sort((x, y) => x.sizeCm - y.sizeCm || x.colorCoverage - y.colorCoverage)
      .map((point) => ({
        caseId: point.id,
        caseKey: point.caseKey,
        sizeCm: point.sizeCm,
        colorCoverage: point.colorCoverage,
        pricePen: point.pricePen,
      })),
    densityReference: {
      baseCaseId: base.id,
      baseCaseKey: base.caseKey,
      sizeCm: base.sizeCm,
      colorCoverage: base.colorCoverage,
      anchorCaseId: center.id,
      anchorPricePen: center.pricePen,
    },
    densityCurve: curve.map((point) => ({
      caseId: point.id,
      caseKey: point.caseKey,
      density: point.density,
      pricePen: point.pricePen,
    })),
  };
}

function bracket(knots: number[], x: Prisma.Decimal): [number, number] | null {
  if (!knots.length || !x.isFinite() || x.lt(knots[0]) || x.gt(knots[knots.length - 1]))
    return null;
  const exact = knots.find((knot) => x.eq(knot));
  if (exact !== undefined) return [exact, exact];
  const upper = knots.findIndex((knot) => x.lt(knot));
  return [knots[upper - 1], knots[upper]];
}

function lerp(
  x: Prisma.Decimal,
  left: number,
  right: number,
  a: Prisma.Decimal,
  b: Prisma.Decimal,
) {
  return left === right
    ? a
    : a.plus(b.minus(a).mul(x.minus(left).div(new Decimal(right).minus(left))));
}

export function interpolateCatalogABPrice(
  model: CatalogABModelParameters,
  sizeCm: DecimalInput,
  colorCoverage: DecimalInput,
  estimatedDensity: DecimalInput,
  adjustmentPercent: DecimalInput,
): CatalogABPriceResult {
  const unavailable = { applicable: false, reason: 'MODEL_NOT_APPLICABLE' } as const;
  try {
    if (
      model.algorithmVersion !== CATALOG_AB_ALGORITHM_VERSION ||
      model.anchorDensity !== 60 ||
      model.baseSurface.length !== 20 ||
      model.densityCurve.length !== 5
    )
      return unavailable;
    const size = new Decimal(sizeCm),
      color = new Decimal(colorCoverage),
      density = new Decimal(estimatedDensity);
    const s = bracket(model.sizeKnots, size),
      c = bracket(model.colorKnots, color),
      d = bracket(
        model.densityCurve.map((point) => point.density),
        density,
      );
    if (!s || !c || !d) return unavailable;
    const priceAt = (s: number, c: number) =>
      new Decimal(
        model.baseSurface.find((point) => point.sizeCm === s && point.colorCoverage === c)!
          .pricePen,
      );
    const left = lerp(color, c[0], c[1], priceAt(s[0], c[0]), priceAt(s[0], c[1]));
    const right = lerp(color, c[0], c[1], priceAt(s[1], c[0]), priceAt(s[1], c[1]));
    const base = lerp(size, s[0], s[1], left, right);
    const densityAt = (d: number) =>
      new Decimal(model.densityCurve.find((point) => point.density === d)!.pricePen);
    const densityPrice = lerp(density, d[0], d[1], densityAt(d[0]), densityAt(d[1]));
    const anchor = densityAt(model.anchorDensity);
    const adjustment = new Decimal(adjustmentPercent);
    if (
      !adjustment.isFinite() ||
      adjustment.lte(-100) ||
      adjustment.gt(1000) ||
      !base.isFinite() ||
      base.lte(0) ||
      !densityPrice.isFinite() ||
      densityPrice.lte(0) ||
      !anchor.isFinite() ||
      anchor.lte(0)
    )
      return unavailable;
    const factor = densityPrice.div(anchor);
    const unadjusted = base.mul(densityPrice).div(anchor);
    const adjustmentFactor = new Decimal(1).plus(adjustment.div(100));
    return {
      applicable: true,
      pricePen: unadjusted.mul(adjustmentFactor).toFixed(2),
      calculation: {
        basePricePen: base.toString(),
        densityPricePen: densityPrice.toString(),
        densityAnchorPricePen: anchor.toString(),
        densityFactor: factor.toString(),
        adjustmentFactor: adjustmentFactor.toString(),
        unadjustedPricePen: unadjusted.toString(),
      },
    };
  } catch {
    return unavailable;
  }
}

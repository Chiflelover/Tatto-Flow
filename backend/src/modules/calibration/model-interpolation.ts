import { Prisma } from '../../generated/prisma/client.js';

export const ALGORITHM_VERSION = 'AREA_COLOR_SEPARABLE_V1' as const;

export interface ModelPoint {
  caseId: string;
  type: 'AREA' | 'COLOR';
  areaCm2: number;
  colorCoverage: number;
  pricePen: string;
}

export interface ModelParameters {
  algorithmVersion: typeof ALGORITHM_VERSION;
  areaCurve: { areaCm2: number; pricePen: string }[];
  colorCurve: { colorCoverage: number; factor: string }[];
}

const decimal = (value: string | number) => new Prisma.Decimal(value);

function interpolate(points: { x: number; y: string }[], x: number): Prisma.Decimal | null {
  if (!Number.isFinite(x) || x < points[0].x || x > points[points.length - 1].x) return null;
  const exact = points.find((point) => point.x === x);
  if (exact) return decimal(exact.y);
  const upper = points.findIndex((point) => point.x > x);
  const left = points[upper - 1];
  const right = points[upper];
  const portion = decimal(x).minus(left.x).div(decimal(right.x).minus(left.x));
  return decimal(left.y).plus(decimal(right.y).minus(left.y).mul(portion));
}

export function buildModel(points: ModelPoint[]): ModelParameters {
  if (
    points.some(
      (point) =>
        !Number.isFinite(point.areaCm2) ||
        point.areaCm2 <= 0 ||
        !Number.isFinite(point.colorCoverage) ||
        point.colorCoverage < 0 ||
        point.colorCoverage > 1 ||
        !decimal(point.pricePen).isFinite() ||
        decimal(point.pricePen).lte(0),
    )
  )
    throw new Error('La calibración contiene puntos no válidos.');

  const areaCases = points
    .filter((point) => point.type === 'AREA')
    .sort((a, b) => a.areaCm2 - b.areaCm2);
  const colorCases = points
    .filter((point) => point.type === 'COLOR')
    .sort((a, b) => a.colorCoverage - b.colorCoverage);
  if (areaCases.length < 2 || colorCases.length < 1)
    throw new Error('La calibración necesita al menos dos casos AREA y un caso COLOR.');
  if (areaCases.some((point) => point.colorCoverage !== 0))
    throw new Error('Los casos AREA deben representar referencias sin cobertura de color.');
  if (areaCases.some((point, index) => index > 0 && point.areaCm2 === areaCases[index - 1].areaCm2))
    throw new Error('Los casos AREA no pueden repetir el área.');
  if (
    colorCases.some(
      (point, index) =>
        point.colorCoverage <= 0 ||
        (index > 0 && point.colorCoverage === colorCases[index - 1].colorCoverage),
    )
  )
    throw new Error('Los casos COLOR necesitan coberturas distintas y mayores que cero.');

  const areaCurve = areaCases.map((point) => ({
    areaCm2: point.areaCm2,
    pricePen: point.pricePen,
  }));
  const basePoints = areaCurve.map((point) => ({ x: point.areaCm2, y: point.pricePen }));
  const colorCurve = [{ colorCoverage: 0, factor: '1' }];
  for (const point of colorCases) {
    const basePrice = interpolate(basePoints, point.areaCm2);
    if (!basePrice) throw new Error('El área de un caso COLOR queda fuera de la curva AREA.');
    colorCurve.push({
      colorCoverage: point.colorCoverage,
      factor: decimal(point.pricePen).div(basePrice).toString(),
    });
  }
  return { algorithmVersion: ALGORITHM_VERSION, areaCurve, colorCurve };
}

export function interpolatePrice(
  model: ModelParameters,
  areaCm2: number,
  colorCoverage: number,
  adjustmentPercent: string | number,
): { applicable: true; pricePen: string } | { applicable: false; reason: 'MODEL_NOT_APPLICABLE' } {
  if (model.algorithmVersion !== ALGORITHM_VERSION)
    return { applicable: false, reason: 'MODEL_NOT_APPLICABLE' };
  const base = interpolate(
    model.areaCurve.map((point) => ({ x: point.areaCm2, y: point.pricePen })),
    areaCm2,
  );
  const colorFactor = interpolate(
    model.colorCurve.map((point) => ({ x: point.colorCoverage, y: point.factor })),
    colorCoverage,
  );
  if (!base || !colorFactor) return { applicable: false, reason: 'MODEL_NOT_APPLICABLE' };
  const adjustmentFactor = decimal(1).plus(decimal(adjustmentPercent).div(100));
  return {
    applicable: true,
    pricePen: base.mul(colorFactor).mul(adjustmentFactor).toDecimalPlaces(2).toFixed(2),
  };
}

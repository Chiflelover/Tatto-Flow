import { describe, expect, it } from 'vitest';
import {
  ALGORITHM_VERSION,
  buildModel,
  interpolatePrice,
  type ModelPoint,
} from './model-interpolation.js';

const area = (id: string, areaCm2: number, pricePen: number): ModelPoint => ({
  caseId: id,
  type: 'AREA',
  areaCm2,
  colorCoverage: 0,
  pricePen: pricePen.toFixed(2),
});
const color = (
  id: string,
  areaCm2: number,
  colorCoverage: number,
  pricePen: number,
): ModelPoint => ({
  caseId: id,
  type: 'COLOR',
  areaCm2,
  colorCoverage,
  pricePen: pricePen.toFixed(2),
});
const points = [
  area('a', 25, 250),
  area('b', 50, 350),
  area('c', 100, 600),
  area('d', 150, 750),
  area('e', 220, 1000),
  color('f', 50, 0.25, 385),
  color('g', 100, 0.5, 720),
  color('h', 150, 0.75, 1050),
  color('i', 100, 1, 960),
];

describe('AREA_COLOR_SEPARABLE_V1', () => {
  const model = buildModel(points);

  it('stores a stable algorithm version and accepts a variable number of cases', () => {
    expect(model.algorithmVersion).toBe(ALGORITHM_VERSION);
    expect(buildModel(points.slice(0, 8)).colorCurve).toHaveLength(4);
    expect(
      buildModel([...points, area('j', 180, 850), color('k', 100, 0.9, 900), area('l', 200, 950)])
        .areaCurve,
    ).toHaveLength(7);
  });

  it('returns exact AREA prices and linearly interpolates with distinct segment slopes', () => {
    expect(interpolatePrice(model, 25, 0, 0)).toEqual({ applicable: true, pricePen: '250.00' });
    expect(interpolatePrice(model, 75, 0, 0)).toEqual({ applicable: true, pricePen: '475.00' });
    expect(interpolatePrice(model, 125, 0, 0)).toEqual({ applicable: true, pricePen: '675.00' });
    expect(interpolatePrice(model, 185, 0, 0)).toEqual({ applicable: true, pricePen: '875.00' });
  });

  it('does not extrapolate the AREA curve', () => {
    expect(interpolatePrice(model, 24.99, 0, 0)).toEqual({
      applicable: false,
      reason: 'MODEL_NOT_APPLICABLE',
    });
    expect(interpolatePrice(model, 220.01, 0, 0)).toEqual({
      applicable: false,
      reason: 'MODEL_NOT_APPLICABLE',
    });
  });

  it('anchors zero color at factor one and derives other factors from responses', () => {
    expect(model.colorCurve[0]).toEqual({ colorCoverage: 0, factor: '1' });
    expect(model.colorCurve[1]).toEqual({ colorCoverage: 0.25, factor: '1.1' });
    expect(interpolatePrice(model, 50, 0.25, 0)).toEqual({ applicable: true, pricePen: '385.00' });
    expect(interpolatePrice(model, 50, 0.375, 0)).toEqual({ applicable: true, pricePen: '402.50' });
  });

  it('uses artist and style specific color responses', () => {
    const otherArtist = buildModel(
      points.map((point) =>
        point.type === 'COLOR'
          ? { ...point, pricePen: (Number(point.pricePen) * 1.25).toFixed(2) }
          : point,
      ),
    );
    const otherStyle = buildModel(
      points.map((point) =>
        point.type === 'COLOR'
          ? { ...point, pricePen: (Number(point.pricePen) * 0.8).toFixed(2) }
          : point,
      ),
    );
    expect(interpolatePrice(model, 50, 0.25, 0)).toEqual({ applicable: true, pricePen: '385.00' });
    expect(interpolatePrice(otherArtist, 50, 0.25, 0)).toEqual({
      applicable: true,
      pricePen: '481.25',
    });
    expect(interpolatePrice(otherStyle, 50, 0.25, 0)).toEqual({
      applicable: true,
      pricePen: '308.00',
    });
  });

  it('does not extrapolate COLOR coverage and applies adjustment after both curves', () => {
    expect(interpolatePrice(model, 50, -0.01, 0)).toEqual({
      applicable: false,
      reason: 'MODEL_NOT_APPLICABLE',
    });
    expect(interpolatePrice(model, 50, 1.01, 0)).toEqual({
      applicable: false,
      reason: 'MODEL_NOT_APPLICABLE',
    });
    const partialColorRange = buildModel([
      area('low', 25, 250),
      area('high', 100, 600),
      color('partial', 50, 0.5, 420),
    ]);
    expect(interpolatePrice(partialColorRange, 50, 0.75, 0)).toEqual({
      applicable: false,
      reason: 'MODEL_NOT_APPLICABLE',
    });
    expect(interpolatePrice(model, 50, 0.25, 10)).toEqual({ applicable: true, pricePen: '423.50' });
    expect(
      interpolatePrice(
        buildModel([area('one', 25, 347), area('two', 100, 500), color('three', 25, 0.5, 400)]),
        25,
        0,
        0,
      ),
    ).toEqual({ applicable: true, pricePen: '347.00' });
  });

  it('rejects ambiguous cases and COLOR cases beyond AREA range', () => {
    expect(() => buildModel([...points, area('duplicate', 25, 270)])).toThrow();
    expect(() => buildModel([...points, color('outside', 230, 0.9, 1200)])).toThrow();
    expect(() => buildModel([...points, color('duplicate-color', 50, 0.25, 390)])).toThrow();
  });
});

import { catalogABPricingFixture } from '../../../test/fixtures/catalog-ab-pricing.js';
import { buildCatalogABModel, interpolateCatalogABPrice } from './catalog-ab-interpolation.js';

describe('catalog A/B calibrated pricing', () => {
  const points = catalogABPricingFixture(),
    model = buildCatalogABModel(points);
  it.each(points.filter((p) => p.phase === 'A'))(
    'reproduces A price $caseKey at anchor density',
    (point) => {
      expect(
        interpolateCatalogABPrice(model, point.sizeCm, point.colorCoverage, 60, 0),
      ).toMatchObject({ applicable: true, pricePen: point.pricePen });
    },
  );
  it.each(points.filter((p) => p.phase === 'B'))(
    'reproduces density response $caseKey',
    (point) => {
      const result = interpolateCatalogABPrice(model, 11, 0, point.density, 0);
      expect(result).toMatchObject({ applicable: true, pricePen: point.pricePen });
      if (result.applicable)
        expect(Number(result.calculation.densityFactor)).toBe(Number(point.pricePen) / 220);
    },
  );
  it('interpolates between sizes using actual neighboring prices', () => {
    expect(interpolateCatalogABPrice(model, 9, 0, 60, 0)).toMatchObject({ pricePen: '185.00' });
  });
  it('interpolates between color coverages', () => {
    expect(interpolateCatalogABPrice(model, 11, 0.375, 60, 0)).toMatchObject({
      pricePen: '325.00',
    });
  });
  it('interpolates between densities', () => {
    expect(interpolateCatalogABPrice(model, 11, 0, 70, 0)).toMatchObject({
      pricePen: '253.00',
      calculation: { densityFactor: '1.15' },
    });
  });
  it('interpolates 9 cm, 0.25 color and density 73 without requiring an exact catalog case', () => {
    expect(interpolateCatalogABPrice(model, 9, 0.25, 73, 0)).toMatchObject({
      applicable: true,
      pricePen: '289.79',
      calculation: {
        basePricePen: '242.5',
        densityPricePen: '262.9',
        densityFactor: '1.195',
        unadjustedPricePen: '289.7875',
      },
    });
  });
  it.each([
    [4, 0, 20, '50.00'],
    [4, 0, 100, '160.00'],
    [4, 1, 20, '110.00'],
    [4, 1, 100, '352.00'],
    [30, 0, 20, '300.00'],
    [30, 0, 100, '960.00'],
    [30, 1, 20, '630.00'],
    [30, 1, 100, '2016.00'],
  ] as const)('accepts exact calibrated boundaries %s/%s/%s', (size, color, density, pricePen) => {
    expect(interpolateCatalogABPrice(model, size, color, density, 0)).toMatchObject({
      applicable: true,
      pricePen,
    });
  });
  it('uses bilinear weights, learned density and general adjustment, rounding only once to cents', () => {
    expect(interpolateCatalogABPrice(model, 9, 0.375, 70, 10)).toMatchObject({
      pricePen: '346.29',
      calculation: {
        basePricePen: '273.75',
        densityPricePen: '253',
        densityAnchorPricePen: '220',
        densityFactor: '1.15',
        unadjustedPricePen: '314.8125',
        adjustmentFactor: '1.1',
      },
    });
    expect(interpolateCatalogABPrice(model, 9, 0.375, 70, -10)).toMatchObject({
      pricePen: '283.33',
    });
  });
  it.each([
    [3.999, 0, 60],
    [30.001, 0, 60],
    [11, -0.001, 60],
    [11, 1.001, 60],
    [11, 0, 19.99],
    [11, 0, 100.01],
    [11, 0, 0],
    [NaN, 0, 60],
    [11, Infinity, 60],
  ])('does not extrapolate for %s/%s/%s', (size, color, density) => {
    expect(interpolateCatalogABPrice(model, size, color, density, 0)).toEqual({
      applicable: false,
      reason: 'MODEL_NOT_APPLICABLE',
    });
  });
  it('preserves a Decimal size boundary', () => {
    expect(
      interpolateCatalogABPrice(model, '30.000000000000000000000000000001', 0, 60, 0).applicable,
    ).toBe(false);
  });
  it('normalizes B by its own central answer without averaging or replacing A prices', () => {
    const changed = catalogABPricingFixture();
    changed
      .filter((p) => p.phase === 'B')
      .forEach((p) => {
        p.pricePen = String(Number(p.pricePen) * 2);
      });
    const calibrated = buildCatalogABModel(changed);
    expect(calibrated.densityReference.anchorPricePen).toBe('440');
    expect(interpolateCatalogABPrice(calibrated, 11, 0, 60, 0)).toMatchObject({
      pricePen: '220.00',
    });
    expect(interpolateCatalogABPrice(calibrated, 11, 0, 70, 0)).toMatchObject({
      pricePen: '253.00',
      calculation: { densityPricePen: '506', densityFactor: '1.15' },
    });
  });
  it.each(['missing', 'duplicate', 'style', 'catalog', 'base', 'density', 'price'] as const)(
    'refuses an invalid calibration: %s',
    (kind) => {
      const bad = catalogABPricingFixture();
      if (kind === 'missing') bad.pop();
      if (kind === 'duplicate') bad[1].colorCoverage = 0;
      if (kind === 'style') bad[0].styleId = 'another';
      if (kind === 'catalog') bad[0].catalogVersion = 'another';
      if (kind === 'base') bad[20].baseCaseKey = 'FL_A_01';
      if (kind === 'density') bad[20].density = 40;
      if (kind === 'price') bad[0].pricePen = '0';
      expect(() => buildCatalogABModel(bad)).toThrow();
    },
  );
});

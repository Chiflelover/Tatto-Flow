import { describe, expect, it } from 'vitest';
import { catalogManifestFixture } from '../../../test/fixtures/calibration-catalog.js';
import { catalogImageUrl, parseCatalogManifest } from './catalog-manifest.js';

describe('global calibration catalog manifest', () => {
  it('accepts A/B, decimal size/density, and open controlled JSON metadata', () => {
    const parsed = parseCatalogManifest(catalogManifestFixture());
    expect(parsed.cases.map((item) => item.phase)).toEqual(['B', 'A', 'A']);
    expect(parsed.cases[1]).toMatchObject({
      sizeCm: 10.5,
      density: { value: 34.5 },
      color: { coverage: 0.25, metadata: { label: 'test color', palette: ['test'] } },
    });
    expect(catalogImageUrl(parsed, parsed.cases[0].image)).toBe(
      'https://catalog.test.invalid/revision-1/TEST_B_001.png',
    );
    expect(parsed.cases[0]).not.toHaveProperty('accountId');
  });

  it.each(['/calibration-assets/v1/Fine_Line/', '/calibration-assets/v1/Fine_Line'])(
    'accepts frontend image base %s and preserves the public relative route',
    (imageBaseUrl) => {
      const parsed = parseCatalogManifest({ ...catalogManifestFixture(), imageBaseUrl });
      expect(parsed.imageBaseUrl).toBe('/calibration-assets/v1/Fine_Line/');
      expect(catalogImageUrl(parsed, 'FL_A_01.jpg')).toBe(
        '/calibration-assets/v1/Fine_Line/FL_A_01.jpg',
      );
    },
  );

  it.each([
    '//other.invalid/catalog/',
    '/calibration-assets/../private/',
    '/calibration-assets/%2e%2e/private/',
    '/calibration-assets\\private/',
    '/calibration-assets/?query=1',
    '/calibration-assets/#fragment',
    'calibration-assets/v1/Fine_Line/',
    'http://other.invalid/catalog/',
    'https://other.invalid/catalog/?query=1',
  ])('rejects unsafe image base %s', (imageBaseUrl) => {
    expect(() => parseCatalogManifest({ ...catalogManifestFixture(), imageBaseUrl })).toThrow(
      /imageBaseUrl/,
    );
  });

  it.each([0, 18, 34.5, 100])('accepts continuous density %s', (value) => {
    const manifest = catalogManifestFixture();
    manifest.cases[0].density.value = value;
    expect(parseCatalogManifest(manifest).cases[0].density.value).toBe(value);
  });

  it.each([-0.1, 100.1, NaN, Infinity])('rejects invalid density %s', (value) => {
    const manifest = catalogManifestFixture();
    manifest.cases[0].density.value = value;
    expect(() => parseCatalogManifest(manifest)).toThrow(/density.value/);
  });

  it.each([0, -1, NaN, Infinity])('rejects invalid target size %s', (value) => {
    const manifest = catalogManifestFixture();
    manifest.cases[0].sizeCm = value;
    expect(() => parseCatalogManifest(manifest)).toThrow(/sizeCm/);
  });

  it.each([-0.1, 1.1, 0.1234])('rejects invalid or lossy coverage %s', (value) => {
    const manifest = catalogManifestFixture();
    manifest.cases[0].color.coverage = value;
    expect(() => parseCatalogManifest(manifest)).toThrow(/coverage/);
  });

  it('rejects duplicate case IDs', () => {
    const manifest = catalogManifestFixture();
    manifest.cases[1].caseId = manifest.cases[0].caseId;
    expect(() => parseCatalogManifest(manifest)).toThrow(/caseId duplicado/);
  });

  it('rejects duplicate filenames irrespective of letter case', () => {
    const manifest = catalogManifestFixture();
    manifest.cases[1].image = manifest.cases[0].image.toLowerCase();
    expect(() => parseCatalogManifest(manifest)).toThrow(/filename duplicado/);
  });

  it.each(['../image.png', '/image.png', 'folder\\image.png', 'https://other.invalid/image.png'])(
    'rejects unsafe image path %s',
    (image) => {
      const manifest = catalogManifestFixture();
      manifest.cases[0].image = image;
      expect(() => parseCatalogManifest(manifest)).toThrow(/path relativo/);
    },
  );

  it('requires a base for B and prohibits one for A', () => {
    const manifest = catalogManifestFixture();
    manifest.cases[0].baseCaseId = null;
    expect(() => parseCatalogManifest(manifest)).toThrow(/referencia Fase A/);
    manifest.cases[0].baseCaseId = manifest.cases[1].caseId;
    manifest.cases[1].baseCaseId = manifest.cases[0].caseId;
    expect(() => parseCatalogManifest(manifest)).toThrow(/referencia Fase A/);
  });

  it('rejects account ownership and unknown fields', () => {
    const manifest = catalogManifestFixture();
    expect(() => parseCatalogManifest({ ...manifest, accountId: 'A' })).toThrow(
      /campos desconocidos/,
    );
    expect(() =>
      parseCatalogManifest({ ...manifest, cases: [{ ...manifest.cases[1], accountId: 'A' }] }),
    ).toThrow(/campos desconocidos/);
  });

  it('requires a nonempty catalog version and cases', () => {
    const manifest = catalogManifestFixture();
    expect(() => parseCatalogManifest({ ...manifest, catalogVersion: '' })).toThrow(
      /catalogVersion/,
    );
    expect(() => parseCatalogManifest({ ...manifest, cases: [] })).toThrow(/cases/);
  });
});

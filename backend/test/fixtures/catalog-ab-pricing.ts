import { readFileSync } from 'node:fs';
import type { CatalogABPoint } from '../../src/modules/calibration/catalog-ab-interpolation.js';
import {
  parseCatalogManifest,
  catalogImageUrl,
} from '../../src/modules/calibration/catalog-manifest.js';

// Example answers for isolated tests only; never imported into an artist account.
const examplePrices = [
  100, 130, 160, 220, 150, 195, 250, 330, 220, 290, 360, 480, 340, 450, 570, 760, 600, 780, 960,
  1260, 110, 165, 220, 286, 352,
];
export const CATALOG_TEST_STYLE_ID = '00000000-0000-4000-8000-000000000030';
export function catalogABPricingFixture(
  styleId = CATALOG_TEST_STYLE_ID,
  multiplier = 1,
): CatalogABPoint[] {
  const manifest = parseCatalogManifest(
    JSON.parse(
      readFileSync(
        new URL(
          '../../../frontend/public/calibration-assets/v1/Fine_Line/catalog.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as unknown,
  );
  return manifest.cases.map((item, index) => ({
    id: item.caseId,
    caseKey: item.caseId,
    styleId,
    styleCode: item.style,
    phase: item.phase,
    imageUrl: catalogImageUrl(manifest, item.image),
    imageKey: item.image,
    sizeCm: item.sizeCm,
    colorCoverage: item.color.coverage,
    colorMetadata: item.color.metadata,
    density: item.density.value,
    densityMetadata: item.density.metadata,
    catalogVersion: manifest.catalogVersion,
    baseCaseKey: item.baseCaseId,
    displayOrder: item.sortOrder,
    isActive: item.active,
    pricePen: (examplePrices[index] * multiplier).toFixed(2),
  }));
}

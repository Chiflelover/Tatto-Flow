import { ConfigService } from '@nestjs/config';
import { DetailLevel, TattooSize } from '../../generated/prisma/client.js';
import { validateEnvironment } from '../../config/environment.validation.js';
import { ImageAmbiguityLevel, type TattooImageInput } from './domain/image-analysis.types.js';
import { MockImageAnalysisService } from './mock-image-analysis.service.js';

const TEST_IMAGE: TattooImageInput = {
  content: new Uint8Array([1, 2, 3]),
  mimeType: 'image/png',
  fileName: 'referencia.png',
};

function createService(overrides: Record<string, unknown>): MockImageAnalysisService {
  const environment = validateEnvironment({
    AI_MODE: 'mock',
    STORAGE_MODE: 'memory',
    ...overrides,
  });

  return new MockImageAnalysisService(new ConfigService(environment));
}

describe('MockImageAnalysisService', () => {
  it.each([TattooSize.SMALL, TattooSize.MEDIUM, TattooSize.LARGE])(
    'returns the configured size %s',
    async (size) => {
      const service = createService({ AI_MOCK_SIZE: size });

      const result = await service.analyzeTattooImage(TEST_IMAGE);

      expect(result.detectedSize).toBe(size);
    },
  );

  it.each([DetailLevel.LIGHT, DetailLevel.MEDIUM, DetailLevel.DETAILED])(
    'returns the configured detail %s',
    async (detail) => {
      const service = createService({ AI_MOCK_DETAIL: detail });

      const result = await service.analyzeTattooImage(TEST_IMAGE);

      expect(result.detectedDetail).toBe(detail);
    },
  );

  it('returns a confidence of 0.90 as valid analysis data', async () => {
    const service = createService({
      AI_MOCK_SIZE_CONFIDENCE: '0.90',
      AI_MOCK_DETAIL_CONFIDENCE: '0.90',
    });

    const result = await service.analyzeTattooImage(TEST_IMAGE);

    expect(result.sizeConfidence).toBe(0.9);
    expect(result.detailConfidence).toBe(0.9);
  });

  it('uses safe readiness defaults without making a scoring decision', async () => {
    const result = await createService({}).analyzeTattooImage(TEST_IMAGE);

    expect(result).toMatchObject({
      tattooOnSkin: true,
      tattooOnSkinConfidence: 1,
      referenceAnalyzable: true,
      analyzabilityConfidence: 1,
      ambiguityLevel: ImageAmbiguityLevel.NONE,
    });
  });
});

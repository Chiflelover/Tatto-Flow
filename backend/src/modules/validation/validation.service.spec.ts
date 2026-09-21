import { DetailLevel, ReviewReason, TattooSize } from '../../generated/prisma/client.js';
import { ImageAmbiguityLevel } from '../image-analysis/domain/image-analysis.types.js';
import { ValidationService } from './validation.service.js';

const service = new ValidationService();

function validate(
  overrides: Partial<{
    detectedSize: TattooSize;
    sizeConfidence: number;
    detectedDetail: DetailLevel;
    detailConfidence: number;
  }> = {},
) {
  return service.validate({
    selectedSize: TattooSize.MEDIUM,
    selectedDetail: DetailLevel.LIGHT,
    analysis: {
      detectedSize: TattooSize.MEDIUM,
      sizeConfidence: 0.95,
      detectedDetail: DetailLevel.LIGHT,
      detailConfidence: 0.95,
      tattooOnSkin: true,
      tattooOnSkinConfidence: 0.98,
      referenceAnalyzable: true,
      analyzabilityConfidence: 0.97,
      ambiguityLevel: ImageAmbiguityLevel.NONE,
      ...overrides,
    },
  });
}

describe('ValidationService', () => {
  it('verifies matching size and detail with both confidences at 0.95', () => {
    expect(validate()).toEqual({ verified: true, reviewReasons: [] });
  });

  it('accepts the exact 0.90 confidence boundary', () => {
    expect(validate({ sizeConfidence: 0.9, detailConfidence: 0.9 })).toEqual({
      verified: true,
      reviewReasons: [],
    });
  });

  it('requires review at size confidence 0.899', () => {
    expect(validate({ sizeConfidence: 0.899 })).toEqual({
      verified: false,
      reviewReasons: [ReviewReason.LOW_SIZE_CONFIDENCE],
    });
  });

  it('requires review at detail confidence 0.899', () => {
    expect(validate({ detailConfidence: 0.899 })).toEqual({
      verified: false,
      reviewReasons: [ReviewReason.LOW_DETAIL_CONFIDENCE],
    });
  });

  it('reports a size mismatch even with confidence 0.99', () => {
    expect(validate({ detectedSize: TattooSize.LARGE, sizeConfidence: 0.99 })).toEqual({
      verified: false,
      reviewReasons: [ReviewReason.SIZE_MISMATCH],
    });
  });

  it('reports a detail mismatch even with confidence 0.99', () => {
    expect(validate({ detectedDetail: DetailLevel.DETAILED, detailConfidence: 0.99 })).toEqual({
      verified: false,
      reviewReasons: [ReviewReason.DETAIL_MISMATCH],
    });
  });

  it('reports both mismatch reasons', () => {
    expect(
      validate({
        detectedSize: TattooSize.LARGE,
        detectedDetail: DetailLevel.DETAILED,
      }),
    ).toEqual({
      verified: false,
      reviewReasons: [ReviewReason.SIZE_MISMATCH, ReviewReason.DETAIL_MISMATCH],
    });
  });

  it('reports mismatch and low-confidence reasons together', () => {
    expect(
      validate({
        detectedSize: TattooSize.LARGE,
        sizeConfidence: 0.85,
        detectedDetail: DetailLevel.DETAILED,
        detailConfidence: 0.96,
      }),
    ).toEqual({
      verified: false,
      reviewReasons: [
        ReviewReason.SIZE_MISMATCH,
        ReviewReason.DETAIL_MISMATCH,
        ReviewReason.LOW_SIZE_CONFIDENCE,
      ],
    });
  });

  it('reports AI_ERROR when no usable analysis exists', () => {
    expect(
      service.validate({
        selectedSize: TattooSize.MEDIUM,
        selectedDetail: DetailLevel.LIGHT,
        analysis: null,
      }),
    ).toEqual({
      verified: false,
      reviewReasons: [ReviewReason.AI_ERROR],
    });
  });
});

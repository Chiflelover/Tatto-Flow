import { Injectable } from '@nestjs/common';
import { ReviewReason, type DetailLevel, type TattooSize } from '../../generated/prisma/client.js';
import { MINIMUM_AUTOMATIC_QUOTE_CONFIDENCE } from '../image-analysis/domain/image-analysis.constants.js';
import type { ImageAnalysisResult } from '../image-analysis/domain/image-analysis.types.js';

export { MINIMUM_AUTOMATIC_QUOTE_CONFIDENCE } from '../image-analysis/domain/image-analysis.constants.js';

export interface ValidationInput {
  selectedSize: TattooSize;
  selectedDetail: DetailLevel;
  analysis: ImageAnalysisResult | null;
}

export interface ValidationResult {
  verified: boolean;
  reviewReasons: ReviewReason[];
}

@Injectable()
export class ValidationService {
  validate(input: ValidationInput): ValidationResult {
    if (!input.analysis || !this.hasValidConfidences(input.analysis)) {
      return {
        verified: false,
        reviewReasons: [ReviewReason.AI_ERROR],
      };
    }

    const reviewReasons: ReviewReason[] = [];

    if (input.analysis.detectedSize !== input.selectedSize) {
      reviewReasons.push(ReviewReason.SIZE_MISMATCH);
    }

    if (input.analysis.detectedDetail !== input.selectedDetail) {
      reviewReasons.push(ReviewReason.DETAIL_MISMATCH);
    }

    if (input.analysis.sizeConfidence < MINIMUM_AUTOMATIC_QUOTE_CONFIDENCE) {
      reviewReasons.push(ReviewReason.LOW_SIZE_CONFIDENCE);
    }

    if (input.analysis.detailConfidence < MINIMUM_AUTOMATIC_QUOTE_CONFIDENCE) {
      reviewReasons.push(ReviewReason.LOW_DETAIL_CONFIDENCE);
    }

    return {
      verified: reviewReasons.length === 0,
      reviewReasons,
    };
  }

  private hasValidConfidences(analysis: ImageAnalysisResult): boolean {
    return (
      Number.isFinite(analysis.sizeConfidence) &&
      analysis.sizeConfidence >= 0 &&
      analysis.sizeConfidence <= 1 &&
      Number.isFinite(analysis.detailConfidence) &&
      analysis.detailConfidence >= 0 &&
      analysis.detailConfidence <= 1
    );
  }
}

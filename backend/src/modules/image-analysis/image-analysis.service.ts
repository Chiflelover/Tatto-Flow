import type { TattooImageInput } from './domain/image-analysis.types.js';
import type { ImageAnalysisV2Result, VisionStyle } from './domain/image-analysis-v2.types.js';

export interface ImageAnalysisContext {
  leadId?: string;
}

export abstract class ImageAnalysisService {
  abstract readonly providerName: string;

  abstract analyzeTattooImageV2(
    image: TattooImageInput,
    styles: readonly VisionStyle[],
    context?: ImageAnalysisContext,
  ): Promise<ImageAnalysisV2Result>;
}

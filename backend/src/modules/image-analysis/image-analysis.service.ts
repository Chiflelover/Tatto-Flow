import type { ImageAnalysisResult, TattooImageInput } from './domain/image-analysis.types.js';

export interface ImageAnalysisContext {
  leadId?: string;
}

export abstract class ImageAnalysisService {
  abstract readonly providerName: string;

  abstract analyzeTattooImage(
    image: TattooImageInput,
    context?: ImageAnalysisContext,
  ): Promise<ImageAnalysisResult>;
}

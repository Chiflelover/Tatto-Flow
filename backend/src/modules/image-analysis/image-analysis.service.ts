import type { ImageAnalysisResult, TattooImageInput } from './domain/image-analysis.types.js';

export abstract class ImageAnalysisService {
  abstract readonly providerName: string;

  abstract analyzeTattooImage(image: TattooImageInput): Promise<ImageAnalysisResult>;
}

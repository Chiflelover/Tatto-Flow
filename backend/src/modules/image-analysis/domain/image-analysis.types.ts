import type { DetailLevel, TattooSize } from '../../../generated/prisma/client.js';

export interface TattooImageInput {
  content: Uint8Array;
  mimeType: string;
  fileName?: string;
}

export enum ImageAmbiguityLevel {
  NONE = 'NONE',
  MINOR = 'MINOR',
  MAJOR = 'MAJOR',
}

export interface ImageAnalysisResult {
  detectedSize: TattooSize;
  sizeConfidence: number;
  detectedDetail: DetailLevel;
  detailConfidence: number;
  tattooOnSkin: boolean;
  tattooOnSkinConfidence: number;
  referenceAnalyzable: boolean;
  analyzabilityConfidence: number;
  ambiguityLevel: ImageAmbiguityLevel;
}

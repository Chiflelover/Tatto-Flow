import type { DetailLevel, TattooSize } from '../../../generated/prisma/client.js';

export interface TattooImageInput {
  content: Uint8Array;
  mimeType: string;
  fileName?: string;
}

export interface ImageAnalysisResult {
  detectedSize: TattooSize;
  sizeConfidence: number;
  detectedDetail: DetailLevel;
  detailConfidence: number;
}

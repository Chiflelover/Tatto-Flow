import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DetailLevel, TattooSize } from '../../generated/prisma/client.js';
import type { ImageAnalysisResult, TattooImageInput } from './domain/image-analysis.types.js';
import { ImageAnalysisService } from './image-analysis.service.js';

@Injectable()
export class MockImageAnalysisService extends ImageAnalysisService {
  readonly providerName = 'mock';

  constructor(private readonly configService: ConfigService) {
    super();
  }

  analyzeTattooImage(image: TattooImageInput): Promise<ImageAnalysisResult> {
    void image;

    return Promise.resolve({
      detectedSize: this.configService.getOrThrow<TattooSize>('AI_MOCK_SIZE'),
      sizeConfidence: this.configService.getOrThrow<number>('AI_MOCK_SIZE_CONFIDENCE'),
      detectedDetail: this.configService.getOrThrow<DetailLevel>('AI_MOCK_DETAIL'),
      detailConfidence: this.configService.getOrThrow<number>('AI_MOCK_DETAIL_CONFIDENCE'),
    });
  }
}

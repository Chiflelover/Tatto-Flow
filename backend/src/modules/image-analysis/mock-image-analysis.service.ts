import { Injectable } from '@nestjs/common';
import { validateLeadImageFile } from '../storage/lead-image-file.js';
import type { TattooImageInput } from './domain/image-analysis.types.js';
import type { ImageAnalysisV2Result, VisionStyle } from './domain/image-analysis-v2.types.js';
import {
  IMAGE_ANALYSIS_V2_SCHEMA_VERSION,
  parseImageAnalysisV2Response,
} from './image-analysis-v2.contract.js';
import { IMAGE_ANALYSIS_V2_PROMPT_VERSION } from './image-analysis-v2.prompt.js';
import { ImageAnalysisService } from './image-analysis.service.js';

@Injectable()
export class MockImageAnalysisService extends ImageAnalysisService {
  readonly providerName = 'mock';

  analyzeTattooImageV2(
    image: TattooImageInput,
    styles: readonly VisionStyle[],
  ): Promise<ImageAnalysisV2Result> {
    validateLeadImageFile(image);
    // A fixture does not establish visual evidence. Keep unknown measurements and style explicit.
    const rawResponse = {
      valid_tattoo_reference: false,
      reference_validation_confidence: 0,
      style: null,
      composition_aspect_ratio: null,
      composition_fill_ratio: null,
      estimated_density: 0,
      style_confidence: 0,
      scale_reference_type: 'NONE',
      scale_confidence: 0,
      reference_main_dimension_cm: null,
      reference_area_cm2: null,
      area_confidence: 0,
      color_coverage: null,
      color_confidence: 0,
      overall_confidence: 0,
      reference_essentially_black: false,
      extensive_body_coverage: false,
    };
    return Promise.resolve({
      observations: parseImageAnalysisV2Response(JSON.stringify(rawResponse), styles),
      provider: 'mock',
      model: 'deterministic-vision-v2',
      promptVersion: IMAGE_ANALYSIS_V2_PROMPT_VERSION,
      schemaVersion: IMAGE_ANALYSIS_V2_SCHEMA_VERSION,
      rawResponse,
    });
  }
}

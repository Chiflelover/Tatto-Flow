import type { AiMode } from '../../config/environment.validation.js';
import type { ImageAnalysisService } from './image-analysis.service.js';

export function selectImageAnalysisProvider(
  mode: AiMode,
  mockService: ImageAnalysisService,
  geminiService: ImageAnalysisService,
): ImageAnalysisService {
  if (mode === 'mock') {
    return mockService;
  }

  if (mode === 'gemini') {
    return geminiService;
  }

  throw new Error(`AI_MODE no soportado: ${String(mode)}.`);
}

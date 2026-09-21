import type { ImageAnalysisService } from './image-analysis.service.js';
import { selectImageAnalysisProvider } from './image-analysis.provider.js';

describe('selectImageAnalysisProvider', () => {
  const mock = { providerName: 'mock' } as ImageAnalysisService;
  const gemini = { providerName: 'gemini' } as ImageAnalysisService;

  it('selects mock for AI_MODE=mock', () => {
    expect(selectImageAnalysisProvider('mock', mock, gemini)).toBe(mock);
  });

  it('selects Gemini for AI_MODE=gemini', () => {
    expect(selectImageAnalysisProvider('gemini', mock, gemini)).toBe(gemini);
  });
});

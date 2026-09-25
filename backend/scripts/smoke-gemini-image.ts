import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { ConfigService } from '@nestjs/config';
import {
  type GeminiClient,
  GeminiImageAnalysisService,
} from '../src/modules/image-analysis/gemini-image-analysis.service.js';
import { AIProviderError } from '../src/modules/image-analysis/ai-provider.error.js';

const DEFAULT_MODEL = 'gemini-3.8-flash';
const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
const smokeStartedAt = Date.now();

async function main(): Promise<void> {
  const imagePath = process.argv[2];
  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (!imagePath || !apiKey) {
    throw new Error('Uso: GEMINI_API_KEY configurada + npm run gemini:smoke -- <imagen>');
  }

  const content = await readFile(imagePath);
  const service = new GeminiImageAnalysisService(
    new ConfigService({ GEMINI_MODEL: model }),
    new GoogleGenAI({ apiKey }) as GeminiClient,
  );
  const result = await service.analyzeTattooImage({
    content,
    mimeType: mimeTypeFromPath(imagePath),
  });

  console.info(
    JSON.stringify(
      {
        provider: 'gemini',
        model,
        durationMs: Date.now() - smokeStartedAt,
        result,
      },
      null,
      2,
    ),
  );
}

function mimeTypeFromPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    default:
      throw new Error('La imagen debe ser JPEG, PNG o WebP.');
  }
}

void main().catch((error: unknown) => {
  const diagnostic =
    error instanceof AIProviderError
      ? {
          errorCategory: error.category,
          httpStatus: error.status ?? null,
          providerCode: error.code ?? null,
          errorName: error.name,
          retryable: error.retryable,
          message: error.message,
          model,
          durationMs: Date.now() - smokeStartedAt,
        }
      : {
          errorCategory: 'UNKNOWN',
          httpStatus: null,
          providerCode: null,
          errorName: error instanceof Error ? error.name : typeof error,
          retryable: false,
          message: 'Unexpected smoke test failure.',
          model,
          durationMs: Date.now() - smokeStartedAt,
        };
  console.error(JSON.stringify(diagnostic, null, 2));
  process.exitCode = 1;
});

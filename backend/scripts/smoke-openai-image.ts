import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import {
  OPENAI_TIMEOUT_MS,
  OpenAIImageAnalysisService,
} from '../src/modules/image-analysis/openai-image-analysis.service.js';

const DEFAULT_MODEL = 'gpt-5.6-luna';

async function main(): Promise<void> {
  const imagePath = process.argv[2];
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!imagePath || !apiKey) {
    throw new Error('Uso: OPENAI_API_KEY configurada + npm run openai:smoke -- <imagen>');
  }

  const content = await readFile(imagePath);
  const service = new OpenAIImageAnalysisService(
    new ConfigService({ OPENAI_MODEL: process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL }),
    new OpenAI({ apiKey, maxRetries: 0, timeout: OPENAI_TIMEOUT_MS }),
  );
  const result = await service.analyzeTattooImage({
    content,
    mimeType: mimeTypeFromPath(imagePath),
  });

  console.info(JSON.stringify(result, null, 2));
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

void main().catch(() => {
  console.error('La prueba de OpenAI no pudo completarse.');
  process.exitCode = 1;
});

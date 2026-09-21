import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { ConfigService } from '@nestjs/config';
import { GeminiImageAnalysisService } from '../src/modules/image-analysis/gemini-image-analysis.service.js';

const DEFAULT_MODEL = 'gemini-3.8-flash';

async function main(): Promise<void> {
  const imagePath = process.argv[2];
  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (!imagePath || !apiKey) {
    throw new Error('Uso: GEMINI_API_KEY configurada + npm run gemini:smoke -- <imagen>');
  }

  const content = await readFile(imagePath);
  const service = new GeminiImageAnalysisService(
    new ConfigService({ GEMINI_MODEL: process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL }),
    new GoogleGenAI({ apiKey }),
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
  console.error('La prueba de Gemini no pudo completarse.');
  process.exitCode = 1;
});

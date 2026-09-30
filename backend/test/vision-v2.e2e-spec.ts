import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { validateEnvironment } from '../src/config/environment.validation.js';
import { PrismaModule } from '../src/infrastructure/prisma/prisma.module.js';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service.js';
import { GEMINI_CLIENT } from '../src/modules/image-analysis/gemini-image-analysis.service.js';
import { OPENAI_CLIENT } from '../src/modules/image-analysis/openai-image-analysis.service.js';
import { ImageAnalysisModule } from '../src/modules/image-analysis/image-analysis.module.js';
import { ImageAnalysisService } from '../src/modules/image-analysis/image-analysis.service.js';
import { ImageAnalysisV2Service } from '../src/modules/image-analysis/image-analysis-v2.service.js';
import { StorageModule } from '../src/modules/storage/storage.module.js';
import { VISION_IMAGE, VISION_STYLES } from './fixtures/vision-v2.js';

describe('AI_MODE=mock with V1 and controlled V2 (e2e)', () => {
  let app: INestApplication<Server>;
  beforeEach(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          ignoreEnvVars: true,
          load: [() => validateEnvironment({ AI_MODE: 'mock', STORAGE_MODE: 'memory' })],
        }),
        PrismaModule,
        StorageModule,
        ImageAnalysisModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({ tattooStyle: { findMany: vi.fn().mockResolvedValue(VISION_STYLES) } })
      .compile();
    app = module.createNestApplication<INestApplication<Server>>();
    app.setGlobalPrefix('api');
    await app.init();
  });
  afterEach(async () => {
    await app.close();
  });

  it('runs the internal V2 contract without API keys or initialized API clients', async () => {
    const result = await app.get(ImageAnalysisV2Service).analyzeReference(VISION_IMAGE);
    expect(app.get(ImageAnalysisService).providerName).toBe('mock');
    expect(app.get(GEMINI_CLIENT)).toBeNull();
    expect(app.get(OPENAI_CLIENT)).toBeNull();
    expect(result).toMatchObject({
      provider: 'mock',
      promptVersion: 2,
      schemaVersion: 'VISION_V2_2',
      observations: {
        style: null,
        scaleReferenceType: 'NONE',
        scaleConfidence: 0,
        referenceMainDimensionCm: null,
        referenceAreaCm2: null,
        colorCoverage: null,
        overallConfidence: 0,
      },
    });
  });

  it('still supports V1 analysis and exposes no public V2 testing endpoint', async () => {
    expect(await app.get(ImageAnalysisService).analyzeTattooImage(VISION_IMAGE)).toMatchObject({
      detectedSize: 'MEDIUM',
      detectedDetail: 'LIGHT',
      sizeConfidence: 0,
    });
    await request(app.getHttpServer()).post('/api/vision-v2').send({}).expect(404);
  });
});

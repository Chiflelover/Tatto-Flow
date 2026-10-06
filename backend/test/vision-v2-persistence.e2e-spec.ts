import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../src/infrastructure/prisma/prisma.service.js';
import { ImageAnalysisService } from '../src/modules/image-analysis/image-analysis.service.js';
import { ImageAnalysisV2Service } from '../src/modules/image-analysis/image-analysis-v2.service.js';
import { parseImageAnalysisV2Response } from '../src/modules/image-analysis/image-analysis-v2.contract.js';
import { toImageAnalysisV2Observation } from '../src/modules/image-analysis/domain/persisted-image-analysis.js';
import { isolatedDatabase } from './helpers/isolated-database.js';
import {
  VISION_IMAGE,
  VISION_RESPONSE,
  VISION_STYLES,
  visionResult,
} from './fixtures/vision-v2.js';

describe.runIf(process.env.RUN_VISION_V2_DB_TESTS === '1')(
  'Vision V2_5 persistence in isolated PostgreSQL',
  { timeout: 30_000 },
  () => {
    let database: Awaited<ReturnType<typeof isolatedDatabase>>;
    let service: ImageAnalysisV2Service;
    const accountId = randomUUID(),
      customerId = randomUUID(),
      conversationId = randomUUID(),
      historicalLeadId = randomUUID(),
      historicalId = randomUUID();
    let newLeadId: string;
    const analyze = vi.fn().mockResolvedValue(visionResult());

    beforeAll(async () => {
      database = await isolatedDatabase(async (name, client) => {
        if (name !== '20261002190000_add_vision_estimated_density') return;
        await client.query(
          'INSERT INTO tattoo_artist_accounts (id, name, updated_at) VALUES ($1, $2, now())',
          [accountId, 'Vision historical test'],
        );
        await client.query(
          'INSERT INTO customers (id, account_id, phone_number, updated_at) VALUES ($1, $2, $3, now())',
          [customerId, accountId, '51999000001'],
        );
        await client.query(
          "INSERT INTO conversations (id, account_id, customer_id, flow_version, updated_at) VALUES ($1, $2, $3, 'V2', now())",
          [conversationId, accountId, customerId],
        );
        await client.query(
          'INSERT INTO leads (id, account_id, customer_id, conversation_id, updated_at) VALUES ($1, $2, $3, $4, now())',
          [historicalLeadId, accountId, customerId, conversationId],
        );
        const response: Record<string, unknown> = { ...VISION_RESPONSE };
        delete response.estimated_density;
        const { estimatedDensity, ...observations } = parseImageAnalysisV2Response(
          JSON.stringify(response),
          VISION_STYLES,
          'VISION_V2_4',
        );
        expect(estimatedDensity).toBeNull();
        const entries = Object.entries({
          id: historicalId,
          leadId: historicalLeadId,
          analysisVersion: 'V2',
          ...observations,
          promptVersion: 4,
          schemaVersion: 'VISION_V2_4',
          provider: 'gemini',
          model: 'historical-model',
          rawResponse: { outputText: JSON.stringify(response) },
        });
        const columns = entries.map(
          ([key]) => '"' + key.replace(/[A-Z]/g, (letter) => '_' + letter.toLowerCase()) + '"',
        );
        const placeholders = entries.map((_, i) => `$${i + 1}`);
        await client.query(
          `INSERT INTO ai_analyses (${columns.join(',')}) VALUES (${placeholders.join(',')})`,
          entries.map(([, value]) => value),
        );
      });
      await database.prisma.tattooStyle.createMany({ data: VISION_STYLES, skipDuplicates: true });
      const customer = await database.prisma.customer.create({
        data: { accountId, phoneNumber: '51999000002' },
      });
      const conversation = await database.prisma.conversation.create({
        data: {
          accountId,
          customerId: customer.id,
          targetSizeCm: 12,
          lead: { create: { accountId, customerId: customer.id, targetSizeCm: 12 } },
        },
        include: { lead: true },
      });
      newLeadId = conversation.lead!.id;
      service = new ImageAnalysisV2Service(
        database.prisma as unknown as PrismaService,
        { analyzeTattooImageV2: analyze } as unknown as ImageAnalysisService,
      );
    }, 120_000);
    afterAll(async () => {
      if (database) await database.close();
    }, 30_000);
    beforeEach(() => analyze.mockClear());

    it('preserves pre-migration Vision V2_4 with null density and reuses it without analysis', async () => {
      const before = await database.prisma.aiAnalysis.findUniqueOrThrow({
        where: { id: historicalId },
      });
      expect(toImageAnalysisV2Observation(before)).toMatchObject({
        estimatedDensity: null,
        colorCoverage: 0.02,
      });
      expect(
        await service.analyzeAndPersistLeadReference(accountId, historicalLeadId, VISION_IMAGE),
      ).toEqual(before);
      expect(analyze).not.toHaveBeenCalled();
    });
    it('persists decimal density independently of color and leaves pricing unchanged', async () => {
      const stored = await service.analyzeAndPersistLeadReference(
        accountId,
        newLeadId,
        VISION_IMAGE,
      );
      expect(stored).toMatchObject({
        estimatedDensity: 34.5,
        colorCoverage: 0.02,
        schemaVersion: 'VISION_V2_5',
        promptVersion: 5,
      });
      expect(await database.prisma.quote.count()).toBe(0);
      expect(await database.prisma.pricingModelVersion.count()).toBe(0);
    });
    it('enforces nullable finite density bounds in PostgreSQL', async () => {
      for (const density of [-0.01, 100.01, Number.NaN, Infinity, -Infinity]) {
        await expect(
          database.prisma.aiAnalysis.update({
            where: { id: historicalId },
            data: { estimatedDensity: density },
          }),
        ).rejects.toThrow();
      }
      for (const density of [0, 34.5, 100, null]) {
        expect(
          (
            await database.prisma.aiAnalysis.update({
              where: { id: historicalId },
              data: { estimatedDensity: density },
            })
          ).estimatedDensity,
        ).toBe(density);
      }
    });
  },
);

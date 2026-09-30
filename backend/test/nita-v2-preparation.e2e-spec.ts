import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import request from 'supertest';
import { validateEnvironment } from '../src/config/environment.validation.js';
import { PrismaModule } from '../src/infrastructure/prisma/prisma.module.js';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service.js';
import { NitaBusinessHoursService } from '../src/modules/chatbot/nita-business-hours.service.js';
import { NitaV2AnalysisService } from '../src/modules/chatbot/nita-v2-analysis.service.js';
import { NitaV2CompletionService } from '../src/modules/chatbot/nita-v2-completion.service.js';
import { WhatsAppV2DeliveryService } from '../src/modules/whatsapp/whatsapp-v2-delivery.service.js';
import { ImageAnalysisService } from '../src/modules/image-analysis/image-analysis.service.js';
import { ImageAnalysisV2Service } from '../src/modules/image-analysis/image-analysis-v2.service.js';
import { StorageService } from '../src/modules/storage/storage.service.js';
import { WhatsAppCloudApiClient } from '../src/modules/whatsapp/whatsapp-cloud-api.client.js';
import { WhatsAppModule } from '../src/modules/whatsapp/whatsapp.module.js';
import { WhatsAppJobRepository } from '../src/modules/whatsapp/whatsapp-job.repository.js';
import type {
  ColorDeclaration,
  ConversationState,
  Prisma,
} from '../src/generated/prisma/client.js';
import { VISION_IMAGE, visionResult } from './fixtures/vision-v2.js';

describe.runIf(process.env.RUN_NITA_V2_DB_TESTS === '1')(
  'Nita V2 preparation with development DB (e2e)',
  { timeout: 60_000 },
  () => {
    let app: INestApplication<Server>;
    let prisma: PrismaService;
    let storage: StorageService;
    const accounts = [randomUUID(), randomUUID()];
    const styleId = randomUUID();
    const styleCode = `TEST_V2_${styleId.slice(0, 8)}`;
    const channels = [`4${Date.now()}3`, `4${Date.now()}4`];
    const appSecret = randomUUID();
    const messageIds: string[] = [];
    const cloud = { sendMessage: vi.fn().mockResolvedValue(undefined), downloadImage: vi.fn() };
    const analyze = vi.fn();
    function result() {
      const value = visionResult();
      value.observations.style = styleCode;
      return value;
    }

    beforeAll(async () => {
      const local = parse(readFileSync('.env', 'utf8'));
      const module = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            ignoreEnvFile: true,
            ignoreEnvVars: true,
            load: [
              () =>
                validateEnvironment({
                  DATABASE_URL: local.DATABASE_URL,
                  AI_MODE: 'mock',
                  STORAGE_MODE: 'memory',
                  NITA_DEFAULT_FLOW_VERSION: 'V2',
                  WHATSAPP_BUSINESS_ACCOUNT_ID: 'test-business',
                  META_APP_SECRET: appSecret,
                }),
            ],
          }),
          PrismaModule,
          WhatsAppModule,
        ],
      })
        // Earlier phase suites isolate their synchronous services; durable ingress is tested separately.
        .overrideProvider(WhatsAppJobRepository)
        .useValue({ enqueueIfV2: vi.fn().mockResolvedValue({ queued: false }) })
        .overrideProvider(WhatsAppCloudApiClient)
        .useValue(cloud)
        .overrideProvider(NitaBusinessHoursService)
        .useValue({ isOpen: () => true })
        .overrideProvider(ImageAnalysisService)
        .useValue({ providerName: 'controlled-test', analyzeTattooImageV2: analyze })
        // Phase 4B coverage; completion/delivery is exercised by the Phase 5 suite.
        .overrideProvider(NitaV2CompletionService)
        .useValue({
          prepare: (accountId: string, id: string) =>
            prisma.conversation.findFirstOrThrow({ where: { id, accountId } }),
          resumePendingForCustomer: vi.fn().mockResolvedValue(undefined),
        })
        .overrideProvider(WhatsAppV2DeliveryService)
        .useValue({ deliverForCustomer: vi.fn().mockResolvedValue(undefined) })
        .compile();
      app = module.createNestApplication<INestApplication<Server>>({ rawBody: true });
      app.setGlobalPrefix('api');
      app.useLogger(false);
      await app.init();
      prisma = app.get(PrismaService);
      storage = app.get(StorageService);
      await prisma.tattooStyle.create({
        data: { id: styleId, code: styleCode, name: 'Isolated V2 test style' },
      });
      for (const [index, id] of accounts.entries())
        await prisma.tattooArtistAccount.create({
          data: {
            id,
            name: `Phase 4B test ${index}`,
            channel: { create: { phoneNumberId: channels[index], phoneNumber: channels[index] } },
            artistStyles: { create: { styleId, isEnabled: index === 0 } },
          },
        });
    }, 30_000);
    beforeEach(() => {
      analyze.mockReset().mockResolvedValue(result());
      cloud.sendMessage.mockClear();
    });
    afterEach(async () => {
      if (!prisma) return;
      await prisma.lead.deleteMany({ where: { accountId: { in: accounts } } });
      await prisma.conversation.deleteMany({ where: { accountId: { in: accounts } } });
      await prisma.customer.deleteMany({ where: { accountId: { in: accounts } } });
      await prisma.whatsAppInboundMessage.deleteMany({ where: { messageId: { in: messageIds } } });
    }, 30_000);
    afterAll(async () => {
      if (prisma) {
        await prisma.artistStyle.deleteMany({ where: { accountId: { in: accounts } } });
        await prisma.whatsAppChannel.deleteMany({ where: { accountId: { in: accounts } } });
        await prisma.tattooArtistAccount.deleteMany({ where: { id: { in: accounts } } });
        await prisma.tattooStyle.deleteMany({ where: { id: styleId } });
      }
      if (app) await app.close();
    }, 30_000);

    async function seed(
      index = 0,
      changes: { sameSize?: boolean; state?: ConversationState; color?: ColorDeclaration } = {},
    ) {
      const accountId = accounts[index];
      const customer = await prisma.customer.create({
        data: { accountId, phoneNumber: '51900000002' },
      });
      const leadId = randomUUID();
      const path = `leads/${leadId}/${randomUUID()}.png`;
      await storage.upload({
        path,
        content: VISION_IMAGE.content,
        contentType: VISION_IMAGE.mimeType,
      });
      const conversation = await prisma.conversation.create({
        data: {
          accountId,
          customerId: customer.id,
          flowVersion: 'V2',
          currentState: changes.state ?? 'READY_FOR_ANALYSIS',
          firstTattoo: false,
          sameSizeAsReference: changes.sameSize ?? true,
          targetSizeCm: changes.sameSize === false ? 22 : null,
          colorDeclaration: changes.color ?? 'BLACK_ONLY',
          bodyPart: changes.state === 'ASK_BODY_PART' ? null : 'Antebrazo',
          lead: {
            create: {
              id: leadId,
              accountId,
              customerId: customer.id,
              firstTattoo: false,
              sameSizeAsReference: changes.sameSize ?? true,
              targetSizeCm: changes.sameSize === false ? 22 : null,
              colorDeclaration: changes.color ?? 'BLACK_ONLY',
              bodyPart: 'Antebrazo',
              images: { create: { storagePath: path } },
            },
          },
        },
      });
      return { ...conversation, leadId, path };
    }
    async function inbound(
      index = 0,
      id = randomUUID(),
      text = 'Continuar',
      expectedStatuses = [200],
    ) {
      messageIds.push(id);
      const body = JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'test-business',
            changes: [
              {
                field: 'messages',
                value: {
                  metadata: { phone_number_id: channels[index] },
                  messages: [{ id, from: '51900000002', type: 'text', text: { body: text } }],
                },
              },
            ],
          },
        ],
      });
      await request(app.getHttpServer())
        .post('/api/whatsapp/webhook')
        .set('Content-Type', 'application/json')
        .set(
          'X-Hub-Signature-256',
          `sha256=${createHmac('sha256', appSecret).update(body).digest('hex')}`,
        )
        .send(body)
        .expect((response) => {
          expect(expectedStatuses).toContain(response.status);
        });
    }
    async function read(id: string) {
      return prisma.conversation.findUniqueOrThrow({
        where: { id },
        include: { lead: { include: { aiAnalysis: true, images: true, evaluation: true } } },
      });
    }

    it('connects the last intake answer to AI and persists preparation without pricing or final messages', async () => {
      const conversation = await seed(0, { state: 'ASK_BODY_PART' });
      await inbound(0, randomUUID(), 'Antebrazo izquierdo');
      const value = await read(conversation.id);
      expect(value.currentState).toBe('READY_FOR_PRICING');
      expect(value.lead).toMatchObject({
        calculatedMinPrice: null,
        calculatedMaxPrice: null,
        pricingRuleId: null,
        pricingRuleVersion: null,
        priceSentAt: null,
        evaluation: null,
        aiAnalysis: {
          analysisVersion: 'V2',
          provider: 'gemini',
          model: 'gemini-test-model',
          schemaVersion: 'VISION_V2_4',
          rawResponse: result().rawResponse,
        },
        v2Preparation: { decision: 'READY_FOR_PRICING', targetAreaCm2: '54', scaleFactor: '1' },
      });
      expect(cloud.sendMessage).toHaveBeenCalledOnce();
      expect(cloud.sendMessage).toHaveBeenCalledWith(channels[0], '51900000002', {
        type: 'text',
        text: 'Gracias. Guardé tus respuestas y tu referencia.',
      });
      expect(await storage.exists(conversation.path)).toBe(true);
    });
    it('uses client size 22 and relative geometry for area 181.5 and ignores concurrent and later message retries', async () => {
      const observation = result();
      observation.observations.referenceMainDimensionCm = 10;
      observation.observations.referenceAreaCm2 = 42;
      analyze.mockResolvedValue(observation);
      const conversation = await seed(0, { sameSize: false });
      const id = randomUUID();
      await Promise.all([
        inbound(0, id, 'Continuar', [200, 503]),
        inbound(0, id, 'Continuar', [200, 503]),
      ]);
      const first = await read(conversation.id);
      await inbound();
      expect(await read(conversation.id)).toEqual(first);
      expect(first.lead?.v2Preparation).toMatchObject({
        decision: 'READY_FOR_PRICING',
        scaleFactor: null,
        targetAreaCm2: '181.5',
      });
      expect(await prisma.aiAnalysis.count({ where: { lead: { accountId: accounts[0] } } })).toBe(
        1,
      );
      expect(await prisma.conversation.count({ where: { accountId: accounts[0] } })).toBe(1);
      expect(await prisma.lead.count({ where: { accountId: accounts[0] } })).toBe(1);
      expect(analyze).toHaveBeenCalledOnce();
      expect(cloud.sendMessage).not.toHaveBeenCalled();
    });
    it('isolates enabled styles for the same customer phone in two artist accounts', async () => {
      const a = await seed(0);
      const b = await seed(1);
      await inbound(0);
      await inbound(1);
      expect((await read(a.id)).currentState).toBe('READY_FOR_PRICING');
      const second = await read(b.id);
      expect(second.currentState).toBe('HUMAN_REVIEW');
      expect(second.lead?.v2Preparation).toMatchObject({ reviewReasons: ['STYLE_NOT_ENABLED'] });
      await expect(app.get(NitaV2AnalysisService).process(accounts[1], a.id)).rejects.toThrow(
        'Conversación no disponible',
      );
      expect(analyze).toHaveBeenCalledTimes(2);
      expect(cloud.sendMessage).not.toHaveBeenCalled();
    });
    it('settles provider failure into ordinary review with no price, scoring or stuck state', async () => {
      analyze.mockRejectedValue(new Error('Fallback exhausted'));
      const conversation = await seed();
      await inbound();
      const value = await read(conversation.id);
      expect(value.currentState).toBe('HUMAN_REVIEW');
      expect(value.lead).toMatchObject({
        aiAnalysis: null,
        evaluation: null,
        calculatedMinPrice: null,
        v2Preparation: {
          decision: 'HUMAN_REVIEW',
          reviewReasons: ['ANALYSIS_FAILED'],
          specialReviewTypes: [],
        },
      });
      expect(value.v2AnalysisClaimId).toBeNull();
      expect(cloud.sendMessage).not.toHaveBeenCalled();
      expect(await storage.exists(conversation.path)).toBe(true);
    });
    it('preserves both special signals even with low confidence and absent scale', async () => {
      const observation = result();
      observation.observations.extensiveBodyCoverage = true;
      observation.observations.overallConfidence = 0.2;
      observation.observations.scaleReferenceType = 'NONE';
      analyze.mockResolvedValue(observation);
      const conversation = await seed(0, { color: 'MOSTLY_COLOR' });
      await inbound();
      const value = await read(conversation.id);
      expect(value.currentState).toBe('SPECIAL_REVIEW');
      expect(value.lead?.v2Preparation).toMatchObject({
        decision: 'SPECIAL_REVIEW',
        targetColorCoverage: null,
        specialReviewTypes: ['EXTENSIVE_BODY_COVERAGE', 'SPECIAL_REVIEW_COLOR_MODIFICATION'],
      });
      expect(value.lead?.aiAnalysis?.referenceAreaCm2).toBeNull();
      expect(cloud.sendMessage).not.toHaveBeenCalled();
    });
    it('recovers an expired analysis claim and reuses the exact persisted analysis', async () => {
      const conversation = await seed();
      const original = await app
        .get(ImageAnalysisV2Service)
        .analyzeAndPersistLeadReference(accounts[0], conversation.leadId, VISION_IMAGE);
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          currentState: 'ANALYZING',
          v2AnalysisClaimId: randomUUID(),
          v2AnalysisLeaseUntil: new Date(0),
        },
      });
      await inbound();
      const value = await read(conversation.id);
      expect(value.currentState).toBe('READY_FOR_PRICING');
      expect(value.lead?.aiAnalysis).toEqual(original);
      expect(value.lead?.v2Preparation as Prisma.JsonObject).toMatchObject({
        analysisId: original.id,
      });
      expect(analyze).toHaveBeenCalledOnce();
      expect(cloud.sendMessage).not.toHaveBeenCalled();
    });
    it('asks for size instead of treating BODY_CONTEXT as validated physical scale', async () => {
      const observation = result();
      observation.observations.scaleReferenceType = 'BODY_CONTEXT';
      analyze.mockResolvedValue(observation);
      const conversation = await seed(0, { state: 'ASK_BODY_PART' });
      await inbound(0, randomUUID(), 'Antebrazo');
      const value = await read(conversation.id);
      expect(value.currentState).toBe('ASK_TARGET_SIZE_AFTER_ANALYSIS');
      expect(value.lead?.v2Preparation).toMatchObject({
        targetAreaCm2: null,
        reviewReasons: [],
      });
      expect(value.lead?.aiAnalysis?.scaleReferenceType).toBe('BODY_CONTEXT');
      expect(
        await prisma.whatsAppDelivery.count({
          where: { leadId: conversation.leadId, kind: 'TARGET_SIZE' },
        }),
      ).toBe(1);
      expect(cloud.sendMessage).toHaveBeenCalledOnce();
    });

    it('recovers a crash through the same recorded webhook ID after lease expiry, without replaying intake', async () => {
      const conversation = await seed();
      const id = randomUUID();
      await prisma.whatsAppInboundMessage.create({ data: { messageId: id } });
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          currentState: 'ANALYZING',
          v2AnalysisClaimId: randomUUID(),
          v2AnalysisLeaseUntil: new Date(Date.now() + 60_000),
        },
      });
      await inbound(0, id, 'Antebrazo antiguo', [503]);
      expect(analyze).not.toHaveBeenCalled();
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { v2AnalysisLeaseUntil: new Date(0) },
      });
      await inbound(0, id, 'Antebrazo antiguo');
      const finished = await read(conversation.id);
      expect(finished.currentState).toBe('READY_FOR_PRICING');
      expect(finished.bodyPart).toBe('Antebrazo');
      await inbound(0, id);
      expect(await read(conversation.id)).toEqual(finished);
      expect(analyze).toHaveBeenCalledOnce();
      expect(await prisma.aiAnalysis.count({ where: { leadId: conversation.leadId } })).toBe(1);
      expect(cloud.sendMessage).not.toHaveBeenCalled();
    });
  },
);

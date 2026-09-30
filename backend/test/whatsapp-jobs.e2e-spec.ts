import type { INestApplication } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import request from 'supertest';
import { validateEnvironment } from '../src/config/environment.validation.js';
import { PrismaModule } from '../src/infrastructure/prisma/prisma.module.js';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service.js';
import { Prisma, type ColorDeclaration } from '../src/generated/prisma/client.js';
import { CalibrationModule } from '../src/modules/calibration/calibration.module.js';
import { CalibrationService } from '../src/modules/calibration/calibration.service.js';
import { ALGORITHM_VERSION, buildModel } from '../src/modules/calibration/model-interpolation.js';
import { NitaBusinessHoursService } from '../src/modules/chatbot/nita-business-hours.service.js';
import { NitaV2CompletionService } from '../src/modules/chatbot/nita-v2-completion.service.js';
import { QuoteV2Service } from '../src/modules/pricing/quote-v2.service.js';
import { ImageManagementService } from '../src/modules/image-management/image-management.service.js';
import { V2_INVALID_REFERENCE_MESSAGE } from '../src/modules/chatbot/domain/nita-v2-messages.js';
import { prepareV2Case } from '../src/modules/chatbot/domain/nita-v2-decision.js';
import { ImageAnalysisService } from '../src/modules/image-analysis/image-analysis.service.js';
import { ImageAmbiguityLevel } from '../src/modules/image-analysis/domain/image-analysis.types.js';
import { StorageService } from '../src/modules/storage/storage.service.js';
import {
  WhatsAppCloudApiClient,
  WhatsAppSendNotAcceptedError,
} from '../src/modules/whatsapp/whatsapp-cloud-api.client.js';
import { WhatsAppModule } from '../src/modules/whatsapp/whatsapp.module.js';
import { WhatsAppJobRepository } from '../src/modules/whatsapp/whatsapp-job.repository.js';
import { VISION_IMAGE, visionResult } from './fixtures/vision-v2.js';
import { WhatsAppJobDispatcher } from '../src/modules/whatsapp/whatsapp-job-dispatcher.service.js';
import { WhatsAppJobProcessor } from '../src/modules/whatsapp/whatsapp-job-processor.service.js';
import { AIProviderError } from '../src/modules/image-analysis/ai-provider.error.js';
import { WhatsAppAdapter } from '../src/modules/chatbot/whatsapp/whatsapp.adapter.js';
import type { WhatsAppOutboundMessage } from '../src/modules/chatbot/whatsapp/whatsapp.adapter.js';

describe.runIf(process.env.RUN_NITA_V2_DB_TESTS === '1')(
  'Durable WhatsApp V2 jobs with development DB (e2e)',
  { timeout: 60_000 },
  () => {
    let app: INestApplication<Server>;
    let prisma: PrismaService;
    let storage: StorageService;
    const accounts = [randomUUID(), randomUUID()];
    const modelIds = [randomUUID(), randomUUID()];
    const styleId = randomUUID(),
      styleCode = `TEST_P6_${styleId.slice(0, 8)}`;
    const channels = accounts.map(
      (id) =>
        `8${BigInt(`0x${id.replaceAll('-', '')}`)
          .toString()
          .slice(0, 14)}`,
    );
    const appSecret = randomUUID(),
      phone = '51900000005';
    const messageIds: string[] = [];
    const cloud = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
      downloadImage: vi.fn().mockResolvedValue(VISION_IMAGE),
    };
    const analyzeV2 = vi.fn();
    const analyzeV1 = vi.fn().mockResolvedValue({
      detectedSize: 'MEDIUM',
      sizeConfidence: 0.98,
      detectedDetail: 'LIGHT',
      detailConfidence: 0.98,
      tattooOnSkin: true,
      tattooOnSkinConfidence: 0.98,
      referenceAnalyzable: true,
      analyzabilityConfidence: 0.98,
      ambiguityLevel: ImageAmbiguityLevel.NONE,
    });
    function result() {
      const value = visionResult();
      Object.assign(value.observations, {
        style: styleCode,
        referenceAreaCm2: 50,
        referenceMainDimensionCm: 10,
        colorCoverage: 0.5,
        referenceEssentiallyBlack: false,
      });
      return value;
    }
    function parameters(multiplier = 1) {
      return buildModel([
        {
          caseId: 'area-small',
          type: 'AREA',
          areaCm2: 20,
          colorCoverage: 0,
          pricePen: String(200 * multiplier),
        },
        {
          caseId: 'area-large',
          type: 'AREA',
          areaCm2: 100,
          colorCoverage: 0,
          pricePen: String(1000 * multiplier),
        },
        {
          caseId: 'color',
          type: 'COLOR',
          areaCm2: 50,
          colorCoverage: 1,
          pricePen: String(1000 * multiplier),
        },
      ]);
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
                  NITA_DEFAULT_FLOW_VERSION: 'V1',
                  CRON_SECRET: appSecret.repeat(3),
                  WHATSAPP_BUSINESS_ACCOUNT_ID: 'test-business',
                  META_APP_SECRET: appSecret,
                }),
            ],
          }),
          PrismaModule,
          WhatsAppModule,
          CalibrationModule,
        ],
      })
        .overrideProvider(WhatsAppJobDispatcher)
        .useValue({ wake: vi.fn() })
        .overrideProvider(WhatsAppCloudApiClient)
        .useValue(cloud)
        .overrideProvider(NitaBusinessHoursService)
        .useValue({ isOpen: () => true })
        .overrideProvider(ImageAnalysisService)
        .useValue({
          providerName: 'controlled-test',
          analyzeTattooImageV2: analyzeV2,
          analyzeTattooImage: analyzeV1,
        })
        .compile();
      app = module.createNestApplication<INestApplication<Server>>({ rawBody: true });
      app.setGlobalPrefix('api');
      app.useLogger(false);
      await app.init();
      prisma = app.get(PrismaService);
      storage = app.get(StorageService);
      await prisma.tattooStyle.create({
        data: { id: styleId, code: styleCode, name: 'Phase 6A isolated style' },
      });
      for (const [index, id] of accounts.entries())
        await prisma.tattooArtistAccount.create({
          data: {
            id,
            name: `Phase 6A test ${index}`,
            adjustmentPercent: 10,
            artistStyles: { create: { styleId } },
            channel: { create: { phoneNumberId: channels[index], phoneNumber: channels[index] } },
          },
        });
    }, 30_000);
    beforeEach(async () => {
      app.get(ConfigService).set('NITA_DEFAULT_FLOW_VERSION', 'V1');
      analyzeV2.mockReset().mockResolvedValue(result());
      analyzeV1.mockClear();
      cloud.sendMessage.mockReset().mockResolvedValue(undefined);
      cloud.downloadImage.mockClear();
      await prisma.pricingModelVersion.createMany({
        data: accounts.map((accountId, index) => ({
          id: modelIds[index],
          accountId,
          styleId,
          version: 1,
          status: 'ACTIVE',
          algorithmVersion: ALGORITHM_VERSION,
          adjustmentPercent: 10,
          caseSnapshot: [],
          modelParameters: parameters(index + 1) as unknown as Prisma.InputJsonValue,
          activatedAt: new Date(),
        })),
      });
    });
    afterEach(async () => {
      vi.restoreAllMocks();
      if (!prisma) return;
      // Only generated account IDs are touched; Quote/delivery rows cascade with these leads.
      await prisma.whatsAppJob.deleteMany({ where: { accountId: { in: accounts } } });
      await prisma.lead.deleteMany({ where: { accountId: { in: accounts } } });
      await prisma.conversation.deleteMany({ where: { accountId: { in: accounts } } });
      await prisma.customer.deleteMany({ where: { accountId: { in: accounts } } });
      await prisma.whatsAppInboundMessage.deleteMany({ where: { messageId: { in: messageIds } } });
      await prisma.calibrationAnswer.deleteMany({
        where: { modelVersion: { accountId: { in: accounts } } },
      });
      await prisma.pricingModelVersion.deleteMany({ where: { accountId: { in: accounts } } });
      await prisma.calibrationCase.deleteMany({ where: { styleId } });
      await prisma.pricingRule.deleteMany({ where: { accountId: { in: accounts } } });
      await prisma.tattooArtistAccount.updateMany({
        where: { id: { in: accounts } },
        data: { adjustmentPercent: 10, isActive: true },
      });
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
      options: {
        index?: number;
        ready?: boolean;
        color?: ColorDeclaration;
        observation?: ReturnType<typeof visionResult>;
      } = {},
    ) {
      const index = options.index ?? 0,
        accountId = accounts[index];
      const customer = await prisma.customer.upsert({
        where: { accountId_phoneNumber: { accountId, phoneNumber: phone } },
        update: {},
        create: { accountId, phoneNumber: phone },
      });
      const leadId = randomUUID(),
        path = `leads/${leadId}/${randomUUID()}.png`;
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
          currentState: options.ready ? 'READY_FOR_PRICING' : 'ASK_BODY_PART',
          firstTattoo: true,
          sameSizeAsReference: true,
          colorDeclaration: options.color ?? 'MOSTLY_COLOR',
          bodyPart: options.ready ? 'Brazo' : null,
          lead: {
            create: {
              id: leadId,
              accountId,
              customerId: customer.id,
              firstTattoo: true,
              sameSizeAsReference: true,
              colorDeclaration: options.color ?? 'MOSTLY_COLOR',
              bodyPart: options.ready ? 'Brazo' : null,
              images: { create: { storagePath: path } },
            },
          },
        },
      });
      if (options.ready) {
        const observation = options.observation ?? result();
        const analysis = await prisma.aiAnalysis.create({
          data: {
            leadId,
            analysisVersion: 'V2',
            ...observation.observations,
            provider: observation.provider,
            model: observation.model,
            promptVersion: observation.promptVersion,
            schemaVersion: observation.schemaVersion,
            rawResponse: observation.rawResponse,
          },
        });
        const preparation = prepareV2Case(conversation, analysis, { exists: true, enabled: true });
        await prisma.lead.update({
          where: { id: leadId },
          data: { v2Preparation: preparation as unknown as Prisma.InputJsonValue },
        });
      }
      return { ...conversation, leadId, index, path };
    }
    async function inbound(
      index = 0,
      value = 'Brazo',
      messageId = randomUUID(),
      type: 'text' | 'button' | 'image' = 'text',
      sender = phone,
    ) {
      messageIds.push(messageId);
      const message = {
        id: messageId,
        from: sender,
        type: type === 'button' ? 'interactive' : type,
        ...(type === 'text'
          ? { text: { body: value } }
          : type === 'button'
            ? { interactive: { type: 'button_reply', button_reply: { id: value } } }
            : { image: { id: value } }),
      };
      const body = JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'test-business',
            changes: [
              {
                field: 'messages',
                value: { metadata: { phone_number_id: channels[index] }, messages: [message] },
              },
            ],
          },
        ],
      });
      const signature = `sha256=${createHmac('sha256', appSecret).update(body).digest('hex')}`;
      return request(app.getHttpServer())
        .post('/api/whatsapp/webhook')
        .set('Content-Type', 'application/json')
        .set('x-hub-signature-256', signature)
        .send(body);
    }
    const read = (id: string) =>
      prisma.lead.findUniqueOrThrow({
        where: { id },
        include: { quote: true, conversation: true, deliveries: true, aiAnalysis: true },
      });

    const processor = () => app.get(WhatsAppJobProcessor);
    const work = (index = 0) => processor().runNext(accounts[index]);
    const jobFor = (inboundMessageId: string) =>
      prisma.whatsAppJob.findUniqueOrThrow({ where: { inboundMessageId } });
    const makeRetryable = (id: string) =>
      prisma.whatsAppJob.update({
        where: { id },
        data: { status: 'RETRYABLE', claimId: null, leaseUntil: null, availableAt: new Date(0) },
      });

    it.each(['AFTER_COMPLETION', 'ALREADY_QUEUED'])(
      'completes INVALID_REFERENCE without pricing or reviews, preserves the image and starts a clean V2 on the next message (%s)',
      async (timing) => {
        app.get(ConfigService).set('NITA_DEFAULT_FLOW_VERSION', 'V2');
        const invalid = result();
        Object.assign(invalid.observations, {
          validTattooReference: false,
          referenceValidationConfidence: 0.99,
          extensiveBodyCoverage: true,
          referenceEssentiallyBlack: true,
          overallConfidence: 0.01,
        });
        analyzeV2.mockResolvedValue(invalid);
        const pricing = vi.spyOn(app.get(QuoteV2Service), 'getOrCreate');
        const f = await seed();
        await prisma.conversation.update({
          where: { id: f.id },
          data: { sameSizeAsReference: false, targetSizeCm: 10 },
        });
        const firstId = randomUUID();
        const secondId = randomUUID();
        await inbound(0, 'Brazo', firstId);
        if (timing === 'ALREADY_QUEUED') await inbound(0, 'hola', secondId);
        expect(await work()).toMatchObject({ status: 'COMPLETED' });
        const history = await read(f.leadId);
        expect(history).toMatchObject({
          status: 'COMPLETED',
          quote: null,
          conversation: { status: 'COMPLETED', currentState: 'INVALID_REFERENCE' },
          v2Preparation: {
            decision: 'INVALID_REFERENCE',
            targetAreaCm2: null,
            targetMainDimensionCm: null,
            reviewReasons: [],
            specialReviewTypes: [],
          },
          aiAnalysis: {
            validTattooReference: false,
            referenceValidationConfidence: 0.99,
            schemaVersion: 'VISION_V2_4',
          },
        });
        expect(pricing).not.toHaveBeenCalled();
        expect(history.deliveries).toHaveLength(1);
        expect(history.deliveries[0]).toMatchObject({
          kind: 'INVALID_REFERENCE',
          payload: { type: 'text', text: V2_INVALID_REFERENCE_MESSAGE },
        });
        expect(history.deliveries[0].sentAt).not.toBeNull();
        expect(await storage.exists(f.path)).toBe(true);
        expect(await prisma.leadImage.count({ where: { leadId: f.leadId, deletedAt: null } })).toBe(
          1,
        );
        const adminImages = await new ImageManagementService(prisma, storage).listAll({
          accountId: accounts[0],
          page: 1,
          pageSize: 50,
        });
        expect(adminImages.images).toHaveLength(1);
        expect(adminImages.images[0]).toMatchObject({
          leadId: f.leadId,
        });
        expect(typeof adminImages.images[0].previewUrl).toBe('string');
        await inbound(0, 'Brazo', firstId);
        expect((await jobFor(firstId)).status).toBe('COMPLETED');
        if (timing === 'AFTER_COMPLETION') expect((await work()).processed).toBe(false);
        await inbound(0, 'hola', secondId);
        expect(await work()).toMatchObject({ status: 'COMPLETED' });
        await inbound(0, 'hola', secondId);
        expect((await work()).processed).toBe(false);
        const fresh = await prisma.conversation.findFirstOrThrow({
          where: { accountId: accounts[0], status: 'ACTIVE' },
          include: { lead: true },
        });
        expect(fresh.id).not.toBe(f.id);
        expect(fresh).toMatchObject({
          flowVersion: 'V2',
          currentState: 'ASK_FIRST_TATTOO',
          firstTattoo: null,
          sameSizeAsReference: null,
          targetSizeCm: null,
          colorDeclaration: null,
          bodyPart: null,
          lead: null,
        });
        expect(await read(f.leadId)).toEqual(history);
        expect(await prisma.conversation.count({ where: { accountId: accounts[0] } })).toBe(2);
        expect(await prisma.lead.count({ where: { accountId: accounts[0] } })).toBe(1);
        expect(analyzeV2).toHaveBeenCalledOnce();
        expect(pricing).not.toHaveBeenCalled();
        expect(await storage.exists(f.path)).toBe(true);
      },
    );

    it('blocks automatic retries of an ambiguous invalid final delivery', async () => {
      const invalid = result();
      invalid.observations.validTattooReference = false;
      analyzeV2.mockResolvedValue(invalid);
      const f = await seed();
      cloud.sendMessage.mockImplementation((_id, _phone, payload: WhatsAppOutboundMessage) =>
        payload.type === 'text' && payload.text === V2_INVALID_REFERENCE_MESSAGE
          ? Promise.reject(new Error('Unknown acceptance'))
          : Promise.resolve(),
      );
      const messageId = randomUUID();
      await inbound(0, 'Brazo', messageId);
      expect(await work()).toMatchObject({ status: 'UNKNOWN' });
      const calls = cloud.sendMessage.mock.calls.length;
      const history = await read(f.leadId);
      expect(history.conversation).toMatchObject({
        status: 'COMPLETED',
        currentState: 'INVALID_REFERENCE',
      });
      expect(history.deliveries[0].lastErrorCode).toBe('DELIVERY_UNKNOWN');
      await inbound(0, 'Brazo', messageId);
      expect((await work()).processed).toBe(false);
      await makeRetryable((await jobFor(messageId)).id);
      expect(await work()).toMatchObject({ status: 'UNKNOWN' });
      expect(cloud.sendMessage).toHaveBeenCalledTimes(calls);
      expect((await read(f.leadId)).quote).toBeNull();
      expect(analyzeV2).toHaveBeenCalledOnce();
    });

    it('recovers only the invalid final delivery after a confirmed send failure without reopening or reanalyzing', async () => {
      const invalid = result();
      invalid.observations.validTattooReference = false;
      analyzeV2.mockResolvedValue(invalid);
      const f = await seed();
      cloud.sendMessage.mockImplementation((_id, _phone, payload: WhatsAppOutboundMessage) => {
        if (payload.type === 'text' && payload.text === V2_INVALID_REFERENCE_MESSAGE)
          return Promise.reject(new WhatsAppSendNotAcceptedError());
        return Promise.resolve();
      });
      const messageId = randomUUID();
      await inbound(0, 'Brazo', messageId);
      expect(await work()).toMatchObject({ status: 'RETRYABLE' });
      const history = await read(f.leadId);
      expect(history.conversation?.status).toBe('COMPLETED');
      expect(history.deliveries[0].lastErrorCode).toBe('DELIVERY_FAILED');
      cloud.sendMessage.mockReset().mockResolvedValue(undefined);
      await makeRetryable((await jobFor(messageId)).id);
      expect(await work()).toMatchObject({ status: 'COMPLETED' });
      expect(cloud.sendMessage).toHaveBeenCalledOnce();
      expect(cloud.sendMessage.mock.calls[0][2]).toEqual({
        type: 'text',
        text: V2_INVALID_REFERENCE_MESSAGE,
      });
      expect(analyzeV2).toHaveBeenCalledOnce();
      const recovered = await read(f.leadId);
      expect(recovered.quote).toBeNull();
      expect(recovered.aiAnalysis).toEqual(history.aiAnalysis);
      expect(recovered.conversation?.currentState).toBe('INVALID_REFERENCE');
      expect(recovered.deliveries).toHaveLength(1);
      expect(recovered.deliveries[0].sentAt).not.toBeNull();
    });

    it.each(['NONE', 'BODY_CONTEXT'] as const)(
      'asks once for SAME_SIZE with %s and quotes after client size without rerunning Vision',
      async (scaleReferenceType) => {
        const observation = result();
        Object.assign(observation.observations, {
          scaleReferenceType,
          referenceMainDimensionCm: scaleReferenceType === 'NONE' ? null : 10,
          referenceAreaCm2: scaleReferenceType === 'NONE' ? null : 50,
          compositionAspectRatio: 0.4,
          compositionFillRatio: 0.7,
        });
        analyzeV2.mockResolvedValue(observation);
        const f = await seed();
        const firstId = randomUUID();
        await inbound(0, 'Brazo', firstId);
        expect(await work()).toMatchObject({ status: 'COMPLETED' });
        const waiting = await read(f.leadId);
        expect(waiting.conversation?.currentState).toBe('ASK_TARGET_SIZE_AFTER_ANALYSIS');
        expect(waiting.quote).toBeNull();
        const question = waiting.deliveries.find((delivery) => delivery.kind === 'TARGET_SIZE')!;
        expect(question.sentAt).not.toBeNull();
        expect(question.payload).toMatchObject({
          type: 'text',
          text: 'No puedo saber el tamaño real de la referencia con suficiente precisión. ¿Aproximadamente de cuántos cm quieres que sea el tatuaje?',
        });
        await inbound(0, 'Brazo', firstId);
        expect((await work()).processed).toBe(false);
        expect(cloud.sendMessage).toHaveBeenCalledTimes(2);
        const secondId = randomUUID();
        await inbound(0, '10 cm', secondId);
        expect(await work()).toMatchObject({ status: 'COMPLETED' });
        const quoted = await read(f.leadId);
        expect(quoted.conversation).toMatchObject({
          currentState: 'ASK_ADVANCE_INTENT',
          sameSizeAsReference: true,
          targetSizeCm: 10,
          bodyPart: 'Brazo',
          colorDeclaration: 'MOSTLY_COLOR',
        });
        expect(quoted).toMatchObject({
          targetSizeCm: 10,
          v2Preparation: { targetAreaCm2: '28', scaleFactor: null },
        });
        expect(quoted.aiAnalysis).toEqual(waiting.aiAnalysis);
        expect(quoted.quote).not.toBeNull();
        expect(analyzeV2).toHaveBeenCalledOnce();
        await inbound(0, '10 cm', secondId);
        expect((await work()).processed).toBe(false);
        expect((await read(f.leadId)).quote).toEqual(quoted.quote);
        expect(await prisma.quote.count({ where: { leadId: f.leadId } })).toBe(1);
        expect(
          quoted.deliveries.filter((delivery) => delivery.kind === 'TARGET_SIZE'),
        ).toHaveLength(1);
        expect(
          await prisma.pricingModelVersion.findUniqueOrThrow({ where: { id: modelIds[0] } }),
        ).toMatchObject({
          status: 'ACTIVE',
          adjustmentPercent: new Prisma.Decimal(10),
          algorithmVersion: ALGORITHM_VERSION,
        });
      },
    );
    it('continues DIFFERENT_SIZE with NONE and reviews absent geometry without inventing area', async () => {
      const observation = result();
      Object.assign(observation.observations, {
        scaleReferenceType: 'NONE',
        referenceMainDimensionCm: null,
        referenceAreaCm2: null,
        compositionAspectRatio: 0.4,
        compositionFillRatio: 0.7,
      });
      analyzeV2.mockResolvedValue(observation);
      const f = await seed();
      await prisma.conversation.update({
        where: { id: f.id },
        data: { sameSizeAsReference: false, targetSizeCm: 10 },
      });
      await inbound();
      expect(await work()).toMatchObject({ status: 'COMPLETED' });
      expect(await read(f.leadId)).toMatchObject({
        v2Preparation: { targetAreaCm2: '28' },
        conversation: { currentState: 'ASK_ADVANCE_INTENT' },
      });
      const invalid = await seed({ index: 1 });
      observation.observations.compositionFillRatio = null;
      await inbound(1);
      expect(await work(1)).toMatchObject({ status: 'COMPLETED' });
      expect(await read(invalid.leadId)).toMatchObject({
        quote: null,
        v2Preparation: {
          decision: 'HUMAN_REVIEW',
          targetAreaCm2: null,
          reviewReasons: ['MISSING_COMPOSITION_GEOMETRY'],
        },
      });
    });
    it.each(['CONFIRMED_FAILURE', 'UNKNOWN', 'PERSISTENCE_FAILURE'] as const)(
      'recovers the size question safely after %s without repeating analysis',
      async (scenario) => {
        const observation = result();
        observation.observations.scaleReferenceType = 'BODY_CONTEXT';
        analyzeV2.mockResolvedValue(observation);
        const f = await seed();
        const id = randomUUID();
        await inbound(0, 'Brazo', id);
        cloud.sendMessage.mockImplementation(
          (_channel, _phone, payload: WhatsAppOutboundMessage) => {
            if (payload.type !== 'text' || !payload.text.startsWith('No puedo saber'))
              return Promise.resolve();
            if (scenario === 'CONFIRMED_FAILURE')
              return Promise.reject(new WhatsAppSendNotAcceptedError());
            if (scenario === 'UNKNOWN') return Promise.reject(new Error('Network outcome unknown'));
            vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('sentAt lost'));
            return Promise.resolve();
          },
        );
        expect(await work()).toMatchObject({
          status: scenario === 'CONFIRMED_FAILURE' ? 'RETRYABLE' : 'UNKNOWN',
        });
        const waiting = await read(f.leadId);
        expect(waiting.conversation?.currentState).toBe('ASK_TARGET_SIZE_AFTER_ANALYSIS');
        expect(waiting.quote).toBeNull();
        const question = waiting.deliveries.find((delivery) => delivery.kind === 'TARGET_SIZE')!;
        expect(question.lastErrorCode).toBe(
          scenario === 'CONFIRMED_FAILURE' ? 'DELIVERY_FAILED' : 'DELIVERY_UNKNOWN',
        );
        cloud.sendMessage.mockReset().mockResolvedValue(undefined);
        await inbound(0, 'Brazo', id);
        if (scenario === 'CONFIRMED_FAILURE') {
          await makeRetryable((await jobFor(id)).id);
          expect(await work()).toMatchObject({ status: 'COMPLETED' });
          expect(cloud.sendMessage).toHaveBeenCalledOnce();
        } else {
          expect((await work()).processed).toBe(false);
          expect(cloud.sendMessage).not.toHaveBeenCalled();
        }
        expect(analyzeV2).toHaveBeenCalledOnce();
        expect(
          await prisma.whatsAppDelivery.count({ where: { leadId: f.leadId, kind: 'TARGET_SIZE' } }),
        ).toBe(1);
      },
    );

    it('ACKs duplicate image events before download and persists one job and one reference', async () => {
      const f = await seed();
      await prisma.conversation.update({
        where: { id: f.id },
        data: { currentState: 'WAITING_IMAGE' },
      });
      await prisma.leadImage.deleteMany({ where: { leadId: f.leadId } });
      const id = randomUUID();
      expect((await inbound(0, 'media-id', id, 'image')).status).toBe(200);
      expect((await inbound(0, 'media-id', id, 'image')).status).toBe(200);
      expect(await prisma.whatsAppJob.count({ where: { inboundMessageId: id } })).toBe(1);
      expect(cloud.downloadImage).not.toHaveBeenCalled();
      expect(analyzeV2).not.toHaveBeenCalled();
      expect(cloud.sendMessage).not.toHaveBeenCalled();
      expect(await work()).toMatchObject({ status: 'COMPLETED' });
      expect(await jobFor(id)).toMatchObject({
        status: 'COMPLETED',
        input: null,
        conversationId: f.id,
        leadId: f.leadId,
      });
      expect((await jobFor(id)).imageId).not.toBeNull();
      expect((await read(f.leadId)).conversation?.currentState).toBe('ASK_SAME_SIZE');
      expect(await prisma.leadImage.count({ where: { leadId: f.leadId } })).toBe(1);
      expect(cloud.downloadImage).toHaveBeenCalledOnce();
      expect(analyzeV2).not.toHaveBeenCalled();
      expect((await work()).processed).toBe(false);
    });
    it('runs Vision, preparation, Quote and delivery after ACK and recovers a finished pipeline once', async () => {
      const f = await seed();
      const id = randomUUID();
      expect((await inbound(0, 'Brazo', id)).status).toBe(200);
      expect(analyzeV2).not.toHaveBeenCalled();
      expect((await read(f.leadId)).quote).toBeNull();
      expect(await work()).toMatchObject({ status: 'COMPLETED' });
      const original = await read(f.leadId);
      expect(original.quote?.amount.toFixed(2)).toBe('825.00');
      expect(original.conversation?.currentState).toBe('ASK_ADVANCE_INTENT');
      expect(analyzeV2).toHaveBeenCalledOnce();
      const count = cloud.sendMessage.mock.calls.length;
      const job = await jobFor(id);
      await prisma.whatsAppJob.update({
        where: { id: job.id },
        data: { status: 'PROCESSING', claimId: randomUUID(), leaseUntil: new Date(0) },
      });
      expect(await work()).toMatchObject({ status: 'COMPLETED' });
      expect((await read(f.leadId)).quote).toEqual(original.quote);
      expect(await prisma.aiAnalysis.count({ where: { leadId: f.leadId } })).toBe(1);
      expect(await prisma.quote.count({ where: { leadId: f.leadId } })).toBe(1);
      expect(cloud.sendMessage).toHaveBeenCalledTimes(count);
      expect(analyzeV2).toHaveBeenCalledOnce();
    });
    it('retries transient Vision failure without repeating the intake ACK or duplicating analysis', async () => {
      const f = await seed();
      const id = randomUUID();
      analyzeV2.mockRejectedValueOnce(
        new AIProviderError({
          provider: 'gemini',
          category: 'TIMEOUT',
          retryable: true,
          fallbackEligible: false,
        }),
      );
      expect((await inbound(0, 'Brazo', id)).status).toBe(200);
      expect(await work()).toMatchObject({ status: 'RETRYABLE' });
      expect((await read(f.leadId)).aiAnalysis).toBeNull();
      expect((await read(f.leadId)).conversation?.currentState).toBe('ANALYZING');
      expect((await jobFor(id)).inputProcessedAt).not.toBeNull();
      await makeRetryable((await jobFor(id)).id);
      expect(await work()).toMatchObject({ status: 'COMPLETED' });
      expect(await prisma.aiAnalysis.count({ where: { leadId: f.leadId } })).toBe(1);
      expect(await prisma.quote.count({ where: { leadId: f.leadId } })).toBe(1);
      expect(analyzeV2).toHaveBeenCalledTimes(2);
      expect(
        (
          await prisma.whatsAppDelivery.findFirstOrThrow({
            where: { jobId: (await jobFor(id)).id, kind: 'INTAKE' },
          })
        ).attemptCount,
      ).toBe(1);
    });
    it('reuses an already persisted analysis after interruption before pricing', async () => {
      const f = await seed();
      const id = randomUUID();
      await inbound(0, 'Brazo', id);
      const completion = app.get(NitaV2CompletionService);
      vi.spyOn(completion, 'prepare').mockRejectedValueOnce(
        new Error('Interrupted before pricing'),
      );
      expect(await work()).toMatchObject({ status: 'RETRYABLE' });
      const original = (await read(f.leadId)).aiAnalysis;
      expect(original).not.toBeNull();
      await makeRetryable((await jobFor(id)).id);
      expect(await work()).toMatchObject({ status: 'COMPLETED' });
      expect((await read(f.leadId)).aiAnalysis).toEqual(original);
      expect(analyzeV2).toHaveBeenCalledOnce();
    });
    it('reuses Quote after confirmed price failure and a changed model adjustment', async () => {
      const f = await seed({ ready: true });
      const id = randomUUID();
      cloud.sendMessage.mockRejectedValueOnce(new WhatsAppSendNotAcceptedError());
      await inbound(0, 'continuar', id);
      expect(await work()).toMatchObject({ status: 'RETRYABLE' });
      const original = (await read(f.leadId)).quote;
      await app.get(CalibrationService).setAdjustment(accounts[0], 50);
      await makeRetryable((await jobFor(id)).id);
      expect(await work()).toMatchObject({ status: 'COMPLETED' });
      expect((await read(f.leadId)).quote).toEqual(original);
      expect(original?.amount.toFixed(2)).toBe('825.00');
      expect(
        (await read(f.leadId)).deliveries.find((item) => item.kind === 'RESULT')?.attemptCount,
      ).toBe(2);
    });
    it('keeps UNKNOWN price blocked through duplicate webhooks and recovery calls', async () => {
      const f = await seed({ ready: true });
      const id = randomUUID();
      cloud.sendMessage.mockRejectedValueOnce(new Error('Unknown acceptance'));
      await inbound(0, 'continuar', id);
      expect(await work()).toMatchObject({ status: 'UNKNOWN' });
      const original = (await read(f.leadId)).quote;
      await inbound(0, 'continuar', id);
      expect((await work()).processed).toBe(false);
      expect((await jobFor(id)).status).toBe('UNKNOWN');
      expect((await read(f.leadId)).quote).toEqual(original);
      expect(cloud.sendMessage).toHaveBeenCalledOnce();
      expect(
        (await read(f.leadId)).deliveries.find((item) => item.kind === 'ADVANCE_INTENT')
          ?.attemptCount,
      ).toBe(0);
    });
    it('retries only the question when price is already confirmed', async () => {
      const f = await seed({ ready: true });
      const id = randomUUID();
      cloud.sendMessage
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new WhatsAppSendNotAcceptedError());
      await inbound(0, 'continuar', id);
      expect(await work()).toMatchObject({ status: 'RETRYABLE' });
      await makeRetryable((await jobFor(id)).id);
      expect(await work()).toMatchObject({ status: 'COMPLETED' });
      expect(
        (await read(f.leadId)).deliveries.find((item) => item.kind === 'RESULT')?.attemptCount,
      ).toBe(1);
      expect(
        cloud.sendMessage.mock.calls.filter((call) => JSON.stringify(call[2]).includes('S/')),
      ).toHaveLength(1);
    });
    it('allows only one worker to own the job while Vision is running', async () => {
      const f = await seed();
      await inbound();
      let begin!: () => void, complete!: (value: ReturnType<typeof result>) => void;
      const begun = new Promise<void>((resolve) => {
        begin = resolve;
      });
      const pending = new Promise<ReturnType<typeof result>>((resolve) => {
        complete = resolve;
      });
      analyzeV2.mockImplementationOnce(() => {
        begin();
        return pending;
      });
      const first = work();
      await begun;
      expect((await work()).processed).toBe(false);
      complete(result());
      expect(await first).toMatchObject({ status: 'COMPLETED' });
      expect(await prisma.quote.count({ where: { leadId: f.leadId } })).toBe(1);
      expect(analyzeV2).toHaveBeenCalledOnce();
    });
    it('recovers an expired worker lease and rejects its stale checkpoint', async () => {
      const f = await seed({ ready: true });
      const id = randomUUID();
      await inbound(0, 'continuar', id);
      const jobs = app.get(WhatsAppJobRepository);
      const stale = (await jobs.claim(accounts[0]))!;
      await prisma.whatsAppJob.update({
        where: { id: stale.id },
        data: { leaseUntil: new Date(0) },
      });
      expect(await work()).toMatchObject({ status: 'COMPLETED' });
      await expect(prisma.$transaction((tx) => jobs.checkpoint(tx, stale, f, []))).rejects.toThrow(
        'ya no pertenece',
      );
      expect(await prisma.quote.count({ where: { leadId: f.leadId } })).toBe(1);
    });
    it('preserves the atomic intake receipt if the worker fails after committing a transition', async () => {
      const f = await seed();
      const id = randomUUID();
      await prisma.conversation.update({
        where: { id: f.id },
        data: { currentState: 'ASK_FIRST_TATTOO', firstTattoo: null },
      });
      await inbound(0, 'sí', id);
      const adapter = app.get(WhatsAppAdapter);
      const original = adapter.handleIncoming.bind(adapter);
      vi.spyOn(adapter, 'handleIncoming').mockImplementationOnce(async (...args) => {
        await original(...args);
        throw new Error('Worker died after commit');
      });
      expect(await work()).toMatchObject({ status: 'RETRYABLE' });
      expect((await read(f.leadId)).conversation?.currentState).toBe('WAITING_IMAGE');
      await makeRetryable((await jobFor(id)).id);
      expect(await work()).toMatchObject({ status: 'COMPLETED' });
      expect((await read(f.leadId)).conversation?.currentState).toBe('WAITING_IMAGE');
      expect((await jobFor(id)).input).toBeNull();
      expect(cloud.sendMessage).toHaveBeenCalledOnce();
    });
    it('isolates queued work and pricing for accounts sharing a customer phone', async () => {
      const a = await seed({ ready: true }),
        b = await seed({ index: 1, ready: true });
      const idA = randomUUID(),
        idB = randomUUID();
      await inbound(0, 'continuar', idA);
      await inbound(1, 'continuar', idB);
      expect(await work(1)).toMatchObject({ status: 'COMPLETED' });
      expect((await jobFor(idA)).status).toBe('PENDING');
      expect(await work(0)).toMatchObject({ status: 'COMPLETED' });
      expect((await read(a.leadId)).quote?.amount.toFixed(2)).toBe('825.00');
      expect((await read(b.leadId)).quote?.amount.toFixed(2)).toBe('1650.00');
      await expect(
        app.get(WhatsAppJobRepository).owned({ ...(await jobFor(idA)), accountId: accounts[1] }),
      ).rejects.toThrow();
      expect(cloud.sendMessage.mock.calls.map((call) => String(call[0]))).toEqual([
        channels[1],
        channels[1],
        channels[0],
        channels[0],
      ]);
    });
    it('retains a pending job without sending if its account was disabled after ACK', async () => {
      await seed();
      const id = randomUUID();
      await inbound(0, 'Brazo', id);
      await prisma.tattooArtistAccount.update({
        where: { id: accounts[0] },
        data: { isActive: false },
      });
      expect(await work()).toMatchObject({ status: 'FAILED' });
      expect(await jobFor(id)).toMatchObject({
        lastErrorCode: 'ACCOUNT_INACTIVE',
        inputProcessedAt: null,
      });
      expect(cloud.sendMessage).not.toHaveBeenCalled();
      expect(analyzeV2).not.toHaveBeenCalled();
    });
    it('requires authorization to recover work over GET/POST', async () => {
      await seed({ ready: true });
      await inbound();
      await request(app.getHttpServer()).get('/api/whatsapp/jobs/process').expect(401);
      await request(app.getHttpServer())
        .get('/api/whatsapp/jobs/process')
        .set('Authorization', `Bearer ${appSecret.repeat(3)}`)
        .expect(200);
      await request(app.getHttpServer())
        .post('/api/whatsapp/jobs/process')
        .set('Authorization', `Bearer ${appSecret.repeat(3)}`)
        .expect(200);
      expect(cloud.sendMessage).toHaveBeenCalledTimes(2);
    });
    it('keeps V1 as the default for a new customer without queuing or running V2', async () => {
      expect((await inbound(0, 'hola')).status).toBe(200);
      const conversation = await prisma.conversation.findFirstOrThrow({
        where: { accountId: accounts[0] },
      });
      expect(conversation).toMatchObject({ flowVersion: 'V1', currentState: 'ASK_SIZE' });
      expect(await prisma.whatsAppJob.count({ where: { accountId: accounts[0] } })).toBe(0);
      expect(analyzeV2).not.toHaveBeenCalled();
      expect(cloud.sendMessage).toHaveBeenCalledTimes(2);
    });
    it('serializes successive inputs until the earlier job completes', async () => {
      const f = await seed();
      await prisma.conversation.update({
        where: { id: f.id },
        data: {
          currentState: 'ASK_FIRST_TATTOO',
          firstTattoo: null,
        },
      });
      const firstId = randomUUID(),
        secondId = randomUUID();
      await inbound(0, 'sí', firstId);
      await inbound(0, 'hola', secondId);
      const jobs = app.get(WhatsAppJobRepository);
      const first = (await jobs.claim(accounts[0]))!;
      expect(first.inboundMessageId).toBe(firstId);
      expect(await jobs.claim(accounts[0])).toBeNull();
      await prisma.whatsAppJob.update({
        where: { id: first.id },
        data: { leaseUntil: new Date(0) },
      });
      expect(await work()).toMatchObject({ status: 'COMPLETED' });
      expect((await jobFor(secondId)).status).toBe('PENDING');
      expect(cloud.sendMessage).toHaveBeenCalledOnce();
      expect(await work()).toMatchObject({ status: 'COMPLETED' });
      expect((await read(f.leadId)).conversation).toMatchObject({
        firstTattoo: true,
        currentState: 'WAITING_IMAGE',
      });
      expect(await prisma.conversation.count({ where: { accountId: accounts[0] } })).toBe(1);
      expect(cloud.sendMessage).toHaveBeenCalledTimes(3);
    });
    it('starts a fresh V2 intake when the queued customer conversation expires before processing', async () => {
      const f = await seed();
      await prisma.conversation.update({
        where: { id: f.id },
        data: { lastActivityAt: new Date(0) },
      });
      const id = randomUUID();
      await inbound(0, 'hola', id);
      expect(await work()).toMatchObject({ status: 'COMPLETED' });
      const historical = await read(f.leadId);
      expect(historical.conversation?.status).toBe('ABANDONED');
      expect(await prisma.leadImage.count({ where: { leadId: f.leadId, deletedAt: null } })).toBe(
        1,
      );
      expect(await storage.exists(f.path)).toBe(true);
      const fresh = await prisma.conversation.findFirstOrThrow({
        where: { accountId: accounts[0], status: 'ACTIVE' },
      });
      expect(fresh).toMatchObject({
        flowVersion: 'V2',
        currentState: 'ASK_FIRST_TATTOO',
        firstTattoo: null,
        sameSizeAsReference: null,
        targetSizeCm: null,
        colorDeclaration: null,
        bodyPart: null,
      });
      expect(fresh.id).not.toBe(f.id);
      expect((await jobFor(id)).conversationId).toBe(fresh.id);
      await inbound(0, 'hola', id);
      expect((await work()).processed).toBe(false);
      expect(await prisma.conversation.count({ where: { accountId: accounts[0] } })).toBe(2);
      expect(analyzeV2).not.toHaveBeenCalled();
    });
    it('blocks an intake reply if WhatsApp accepted it but persisting sentAt failed', async () => {
      const f = await seed();
      await prisma.conversation.update({
        where: { id: f.id },
        data: { currentState: 'ASK_FIRST_TATTOO', firstTattoo: null },
      });
      const id = randomUUID();
      await inbound(0, 'sí', id);
      cloud.sendMessage.mockImplementationOnce(() => {
        vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(
          new Error('sentAt persistence lost'),
        );
        return Promise.resolve();
      });
      expect(await work()).toMatchObject({ status: 'UNKNOWN' });
      const job = await jobFor(id);
      expect(
        (await prisma.whatsAppDelivery.findFirstOrThrow({ where: { jobId: job.id } }))
          .lastErrorCode,
      ).toBe('DELIVERY_UNKNOWN');
      await inbound(0, 'sí', id);
      expect((await work()).processed).toBe(false);
      expect(cloud.sendMessage).toHaveBeenCalledOnce();
      expect((await read(f.leadId)).conversation?.currentState).toBe('WAITING_IMAGE');
    });
    it.each(['INTAKE', 'RESULT'])(
      'recovers lost commit acknowledgement for %s without resending the persisted message',
      async (kind) => {
        const f = await seed({ ready: kind === 'RESULT' });
        if (kind === 'INTAKE')
          await prisma.conversation.update({
            where: { id: f.id },
            data: {
              currentState: 'ASK_FIRST_TATTOO',
              firstTattoo: null,
            },
          });
        const id = randomUUID();
        await inbound(0, kind === 'INTAKE' ? 'sí' : 'continuar', id);
        const transact = prisma.$transaction.bind(prisma);
        cloud.sendMessage.mockImplementationOnce(() => {
          vi.spyOn(prisma, '$transaction').mockImplementationOnce(async (...args) => {
            await transact(...args);
            throw new Error('Commit acknowledgement lost');
          });
          return Promise.resolve();
        });
        expect(await work()).toMatchObject({ status: 'RETRYABLE' });
        const job = await jobFor(id);
        const delivery = await prisma.whatsAppDelivery.findFirstOrThrow({
          where: {
            accountId: accounts[0],
            kind,
            ...(kind === 'INTAKE' ? { jobId: job.id } : { leadId: f.leadId }),
          },
        });
        expect(delivery.sentAt).not.toBeNull();
        const quote = (await read(f.leadId)).quote;
        await makeRetryable(job.id);
        expect(await work()).toMatchObject({ status: 'COMPLETED' });
        expect((await read(f.leadId)).quote).toEqual(quote);
        expect(
          (await prisma.whatsAppDelivery.findUniqueOrThrow({ where: { id: delivery.id } }))
            .attemptCount,
        ).toBe(1);
        expect(cloud.sendMessage).toHaveBeenCalledTimes(kind === 'INTAKE' ? 1 : 2);
      },
    );
  },
);

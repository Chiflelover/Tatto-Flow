import { WhatsAppJobDispatcher } from '../src/modules/whatsapp/whatsapp-job-dispatcher.service.js';
import { WhatsAppJobProcessor } from '../src/modules/whatsapp/whatsapp-job-processor.service.js';
import { WhatsAppV2DeliveryService } from '../src/modules/whatsapp/whatsapp-v2-delivery.service.js';
import { isolatedDatabase } from './helpers/isolated-database.js';
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
import { Prisma, type ColorDeclaration } from '../src/generated/prisma/client.js';
import { CalibrationModule } from '../src/modules/calibration/calibration.module.js';
import { CalibrationService } from '../src/modules/calibration/calibration.service.js';
import { ALGORITHM_VERSION, buildModel } from '../src/modules/calibration/model-interpolation.js';
import { NitaBusinessHoursService } from '../src/modules/chatbot/nita-business-hours.service.js';
import { NitaV2CompletionService } from '../src/modules/chatbot/nita-v2-completion.service.js';
import { prepareV2Case } from '../src/modules/chatbot/domain/nita-v2-decision.js';
import {
  V2_BOOKING_BUTTON_IDS,
  V2_REVIEW_MESSAGE,
} from '../src/modules/chatbot/domain/nita-v2-messages.js';
import { DashboardService } from '../src/modules/dashboard/dashboard.service.js';
import { ImageAnalysisService } from '../src/modules/image-analysis/image-analysis.service.js';
import { QuoteV2Service } from '../src/modules/pricing/quote-v2.service.js';
import { StorageService } from '../src/modules/storage/storage.service.js';
import { WhatsAppCloudApiClient } from '../src/modules/whatsapp/whatsapp-cloud-api.client.js';
import { WhatsAppModule } from '../src/modules/whatsapp/whatsapp.module.js';
import { VISION_IMAGE, visionResult } from './fixtures/vision-v2.js';

describe.runIf(process.env.RUN_NITA_V2_DB_TESTS === '1')(
  'Nita V2 pricing, quote and delivery with isolated DB (e2e)',
  { timeout: 60_000 },
  () => {
    let app: INestApplication<Server>;
    let prisma: PrismaService;
    let database: Awaited<ReturnType<typeof isolatedDatabase>>;
    let storage: StorageService;
    const accounts = [randomUUID(), randomUUID()];
    const modelIds = [randomUUID(), randomUUID()];
    const styleId = randomUUID(),
      styleCode = `TEST_P5_${styleId.slice(0, 8)}`;
    const channels = [`6${Date.now()}1`, `6${Date.now()}2`];
    const appSecret = randomUUID(),
      phone = '51900000005';
    const messageIds: string[] = [];
    const cloud = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
      downloadImage: vi.fn().mockResolvedValue(VISION_IMAGE),
    };
    const analyzeV2 = vi.fn();
    function result() {
      const value = visionResult();
      Object.assign(value.observations, {
        style: styleCode,
        referenceAreaCm2: 50,
        referenceMainDimensionCm: 10,
        compositionFillRatio: 1,
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
      database = await isolatedDatabase();
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
        // Drain the real queue explicitly in each test.
        .overrideProvider(WhatsAppJobDispatcher)
        .useValue({ wake: vi.fn() })
        .overrideProvider(PrismaService)
        .useValue(database.prisma)
        .overrideProvider(WhatsAppCloudApiClient)
        .useValue(cloud)
        .overrideProvider(NitaBusinessHoursService)
        .useValue({ isOpen: () => true })
        .overrideProvider(ImageAnalysisService)
        .useValue({
          providerName: 'controlled-test',
          analyzeTattooImageV2: analyzeV2,
        })
        .compile();
      app = module.createNestApplication<INestApplication<Server>>({ rawBody: true });
      app.setGlobalPrefix('api');
      app.useLogger(false);
      await app.init();
      prisma = app.get(PrismaService);
      storage = app.get(StorageService);
      await prisma.tattooStyle.create({
        data: { id: styleId, code: styleCode, name: 'Phase 5 isolated style' },
      });
      for (const [index, id] of accounts.entries())
        await prisma.tattooArtistAccount.create({
          data: {
            id,
            name: `Phase 5 test ${index}`,
            adjustmentPercent: 10,
            artistStyles: { create: { styleId } },
            channel: { create: { phoneNumberId: channels[index], phoneNumber: channels[index] } },
          },
        });
    }, 120_000);
    beforeEach(async () => {
      analyzeV2.mockReset().mockResolvedValue(result());

      cloud.sendMessage.mockReset().mockResolvedValue(undefined);
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

      await prisma.tattooArtistAccount.updateMany({
        where: { id: { in: accounts } },
        data: { adjustmentPercent: 10 },
      });
    }, 120_000);
    afterAll(async () => {
      if (prisma) {
        await prisma.artistStyle.deleteMany({ where: { accountId: { in: accounts } } });
        await prisma.whatsAppChannel.deleteMany({ where: { accountId: { in: accounts } } });
        await prisma.tattooArtistAccount.deleteMany({ where: { id: { in: accounts } } });
        await prisma.tattooStyle.deleteMany({ where: { id: styleId } });
      }
      if (app) await app.close();
      if (database) await database.close();
    }, 120_000);

    async function seed(
      options: {
        index?: number;
        ready?: boolean;
        color?: ColorDeclaration;
        observation?: ReturnType<typeof visionResult>;
        targetSizeCm?: number;
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
          currentState: options.ready ? 'READY_FOR_PRICING' : 'ASK_BODY_PART',
          firstTattoo: true,
          sameSizeAsReference: true,
          targetSizeCm: options.targetSizeCm ?? 10,
          colorDeclaration: options.color ?? 'MEDIUM_COLOR',
          bodyPart: options.ready ? 'Brazo' : null,
          lead: {
            create: {
              id: leadId,
              accountId,
              customerId: customer.id,
              firstTattoo: true,
              sameSizeAsReference: true,
              targetSizeCm: options.targetSizeCm ?? 10,
              colorDeclaration: options.color ?? 'MEDIUM_COLOR',
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
      const response = await request(app.getHttpServer())
        .post('/api/whatsapp/webhook')
        .set('Content-Type', 'application/json')
        .set('x-hub-signature-256', signature)
        .send(body);
      while ((await app.get(WhatsAppJobProcessor).runNext(accounts[index])).processed) {
        // Drain the durable queue without starting background workers.
      }
      return response;
    }
    const read = (id: string) =>
      prisma.lead.findUniqueOrThrow({
        where: { id },
        include: { quote: true, conversation: true, deliveries: true, aiAnalysis: true },
      });
    const dashboard = () => new DashboardService(prisma, storage);

    it.each([0.75, 0.88, 0.91])(
      'completes intake at Vision confidence %s, creates the exact quote and sends one price plus the intent question',
      async (overallConfidence) => {
        const observation = result();
        observation.observations.overallConfidence = overallConfidence;
        analyzeV2.mockResolvedValue(observation);
        const f = await seed();
        const id = randomUUID();
        expect((await inbound(0, 'Brazo', id)).status).toBe(200);
        const lead = await read(f.leadId);
        expect(lead.quote?.amount.toFixed(2)).toBe('825.00');
        expect(lead.quote?.pricingModelVersionId).toBe(modelIds[0]);
        expect(lead.quote?.targetAreaCm2?.toString()).toBe('50');
        expect(lead.quote?.targetColorCoverage.toString()).toBe('0.5');
        expect(lead.status).toBe('AUTO_QUOTED');
        expect(lead.conversation?.currentState).toBe('ASK_ADVANCE_INTENT');
        expect(lead.bookingIntent).toBeNull();

        expect(lead.manualFinalPrice).toBeNull();
        expect(analyzeV2).toHaveBeenCalledOnce();
        expect(lead.aiAnalysis?.schemaVersion).toBe('VISION_V2_5');
        expect(lead.aiAnalysis?.overallConfidence).toBe(overallConfidence);
        const messages = cloud.sendMessage.mock.calls
          .map((call) => JSON.stringify(call[2]))
          .join('\n');
        expect(messages.match(/S\/ 825\.00/g)).toHaveLength(1);
        expect(messages).toContain('¿Deseas coordinar para separar una cita?');
        expect(messages).not.toMatch(/cm²|confidence|AREA_COLOR|scaleFactor/);
        const count = cloud.sendMessage.mock.calls.length;
        expect((await inbound(0, 'Brazo', id)).status).toBe(200);
        expect(cloud.sendMessage).toHaveBeenCalledTimes(count);
        expect(await prisma.quote.count({ where: { leadId: f.leadId } })).toBe(1);
      },
    );
    it.each(['DIRECT_BOOKING', 'ARTIST_CONTACT'] as const)(
      'records %s once and hands off without reserving an appointment',
      async (intent) => {
        const f = await seed({ ready: true });
        expect((await inbound()).status).toBe(200);
        const quote = (await read(f.leadId)).quote;
        const messageId = randomUUID();
        expect((await inbound(0, V2_BOOKING_BUTTON_IDS[intent], messageId, 'button')).status).toBe(
          200,
        );
        const lead = await read(f.leadId);
        expect(lead.bookingIntent).toBe(intent);
        expect(lead.status).toBe(
          intent === 'DIRECT_BOOKING' ? 'READY_TO_COORDINATE' : 'HANDOFF_TO_TATTOO_ARTIST',
        );
        expect(lead.conversation?.status).toBe('COMPLETED');
        expect(lead.conversation?.currentState).toBe('HANDOFF_TO_TATTOO_ARTIST');
        expect(lead.quote).toEqual(quote);
        const count = cloud.sendMessage.mock.calls.length;
        expect((await inbound(0, V2_BOOKING_BUTTON_IDS[intent], messageId, 'button')).status).toBe(
          200,
        );
        expect(
          (
            await inbound(
              0,
              V2_BOOKING_BUTTON_IDS[
                intent === 'DIRECT_BOOKING' ? 'ARTIST_CONTACT' : 'DIRECT_BOOKING'
              ],
              randomUUID(),
              'button',
            )
          ).status,
        ).toBe(200);
        expect((await read(f.leadId)).bookingIntent).toBe(intent);
        expect(cloud.sendMessage).toHaveBeenCalledTimes(count);
      },
    );
    it('falls back to ordinary review without a model and does not ask booking or accept booking for review', async () => {
      const f = await seed({ ready: true });
      await prisma.pricingModelVersion.updateMany({
        where: { accountId: accounts[0] },
        data: { status: 'SUPERSEDED' },
      });
      expect((await inbound()).status).toBe(200);
      const lead = await read(f.leadId);
      expect(lead.quote).toBeNull();
      expect(lead.status).toBe('REQUIRES_REVIEW');
      expect(lead.bookingIntent).toBeNull();
      expect(lead.v2Preparation).toMatchObject({
        decision: 'HUMAN_REVIEW',
        reviewReasons: ['PRICING_MODEL_NOT_AVAILABLE'],
      });
      expect(cloud.sendMessage).toHaveBeenCalledOnce();
      expect(cloud.sendMessage.mock.calls[0][2]).toEqual({ type: 'text', text: V2_REVIEW_MESSAGE });
      expect(
        (await inbound(0, V2_BOOKING_BUTTON_IDS.DIRECT_BOOKING, randomUUID(), 'button')).status,
      ).toBe(200);
      expect((await read(f.leadId)).bookingIntent).toBeNull();
      expect(cloud.sendMessage).toHaveBeenCalledOnce();
      expect(await storage.exists(f.path)).toBe(true);
    });
    it.each(['AREA', 'COLOR'])(
      'routes an input outside the calibrated %s domain to ordinary review',
      async (dimension) => {
        const observation = result();
        if (dimension === 'COLOR') {
          const model = parameters();
          model.colorCurve[1].colorCoverage = 0.4;
          await prisma.pricingModelVersion.update({
            where: { id: modelIds[0] },
            data: { modelParameters: model as unknown as Prisma.InputJsonValue },
          });
        }
        const f = await seed({
          ready: true,
          observation,
          targetSizeCm: dimension === 'AREA' ? 15 : 10,
        });
        expect((await inbound()).status).toBe(200);
        const lead = await read(f.leadId);
        expect(lead.quote).toBeNull();
        expect(lead.v2Preparation).toMatchObject({
          decision: 'HUMAN_REVIEW',
          reviewReasons: ['MODEL_NOT_APPLICABLE'],
        });
        expect(cloud.sendMessage).toHaveBeenCalledOnce();
        expect(lead.bookingIntent).toBeNull();
      },
    );
    it.each(['HUMAN_REVIEW', 'SPECIAL_REVIEW'])(
      'delivers existing %s results without pricing or booking',
      async (decision) => {
        const observation = result();
        if (decision === 'HUMAN_REVIEW') observation.observations.overallConfidence = 0.749999999;
        else
          Object.assign(observation.observations, {
            referenceEssentiallyBlack: true,
            colorCoverage: 0,
            extensiveBodyCoverage: true,
          });
        analyzeV2.mockResolvedValue(observation);
        const f = await seed();
        expect((await inbound()).status).toBe(200);
        const lead = await read(f.leadId);
        expect(lead.quote).toBeNull();
        expect(lead.bookingIntent).toBeNull();
        expect(lead.v2Preparation).toMatchObject({ decision });
        if (decision === 'SPECIAL_REVIEW')
          expect(lead.v2Preparation).toMatchObject({
            specialReviewTypes: ['EXTENSIVE_BODY_COVERAGE', 'SPECIAL_REVIEW_COLOR_MODIFICATION'],
          });
        expect(lead.status).toBe(
          decision === 'SPECIAL_REVIEW' ? 'SPECIAL_REVIEW' : 'REQUIRES_REVIEW',
        );
        expect(lead.conversation?.currentState).toBe('HANDOFF_TO_TATTOO_ARTIST');
        expect(
          cloud.sendMessage.mock.calls.every(
            (call) => JSON.stringify(call[2]).includes('cita') === false,
          ),
        ).toBe(true);
      },
    );
    it('blocks price retries and the booking question after an ambiguous transport result', async () => {
      const f = await seed({ ready: true });
      const id = randomUUID();
      cloud.sendMessage.mockRejectedValueOnce(new Error('Connection lost after request'));
      expect((await inbound(0, 'continuar', id)).status).toBe(200);
      const original = (await read(f.leadId)).quote;
      expect((await inbound(0, 'continuar', id)).status).toBe(200);
      expect(
        (await inbound(0, V2_BOOKING_BUTTON_IDS.DIRECT_BOOKING, randomUUID(), 'button')).status,
      ).toBe(200);
      const lead = await read(f.leadId);
      expect(lead.quote).toEqual(original);
      expect(lead.bookingIntent).toBeNull();
      expect(lead.conversation?.currentState).toBe('PRICE_READY');
      expect(lead.deliveries.find((item) => item.kind === 'RESULT')).toMatchObject({
        sentAt: null,
        lastErrorCode: 'DELIVERY_UNKNOWN',
        attemptCount: 1,
      });
      expect(lead.deliveries.find((item) => item.kind === 'ADVANCE_INTENT')?.attemptCount).toBe(0);
      expect(cloud.sendMessage).toHaveBeenCalledOnce();
    });
    it.each([false, true])(
      'blocks recovery after accepted price and persistence failure (diagnostic also fails: %s)',
      async (diagnosticFails) => {
        const f = await seed({ ready: true });
        const id = randomUUID();
        cloud.sendMessage.mockImplementationOnce(() => {
          vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(
            new Error('sentAt persistence lost'),
          );
          if (diagnosticFails)
            vi.spyOn(prisma.whatsAppDelivery, 'updateMany').mockRejectedValueOnce(
              new Error('DB unavailable'),
            );
          return Promise.resolve();
        });
        expect((await inbound(0, 'continuar', id)).status).toBe(200);
        const initial = await read(f.leadId);
        const delivery = initial.deliveries.find((item) => item.kind === 'RESULT')!;
        expect(delivery.sentAt).toBeNull();
        if (diagnosticFails) {
          expect(delivery.claimId).not.toBeNull();
          // Simulate recovery after the worker lease elapsed; no real waiting or network.
          await prisma.whatsAppDelivery.update({
            where: { id: delivery.id },
            data: { leaseUntil: new Date(Date.now() - 1000) },
          });
        } else expect(delivery.lastErrorCode).toBe('DELIVERY_UNKNOWN');
        if (diagnosticFails) {
          await app
            .get(WhatsAppV2DeliveryService)
            .deliverForCustomer(accounts[0], channels[0], phone);
        }
        expect((await inbound(0, 'continuar', id)).status).toBe(200);
        expect((await inbound(0, 'continuar', id)).status).toBe(200);
        const recovered = await read(f.leadId);
        expect(recovered.quote).toEqual(initial.quote);
        expect(recovered.conversation?.currentState).toBe('PRICE_READY');
        expect(recovered.deliveries.find((item) => item.kind === 'RESULT')).toMatchObject({
          sentAt: null,
          lastErrorCode: 'DELIVERY_UNKNOWN',
          attemptCount: 1,
        });
        expect(
          recovered.deliveries.find((item) => item.kind === 'ADVANCE_INTENT')?.attemptCount,
        ).toBe(0);
        expect(cloud.sendMessage).toHaveBeenCalledOnce();
      },
    );
    it('recovers a lost transaction acknowledgement using persisted sentAt without resending price', async () => {
      const f = await seed({ ready: true });
      const id = randomUUID();
      const transact = prisma.$transaction.bind(prisma);
      cloud.sendMessage.mockImplementationOnce(() => {
        vi.spyOn(prisma, '$transaction').mockImplementationOnce(async (...args) => {
          await transact(...args);
          throw new Error('Commit acknowledgement lost');
        });
        return Promise.resolve();
      });
      expect((await inbound(0, 'continuar', id)).status).toBe(200);
      const initial = await read(f.leadId);
      expect(initial.deliveries.find((item) => item.kind === 'RESULT')?.sentAt).not.toBeNull();
      expect(initial.conversation?.currentState).toBe('PRICE_READY');
      await prisma.whatsAppJob.updateMany({
        where: { inboundMessageId: id, status: 'RETRYABLE' },
        data: { availableAt: new Date(Date.now() - 1000) },
      });
      expect((await inbound(0, 'continuar', id)).status).toBe(200);
      const lead = await read(f.leadId);
      expect(lead.quote).toEqual(initial.quote);
      expect(lead.conversation?.currentState).toBe('ASK_ADVANCE_INTENT');
      expect(lead.deliveries.find((item) => item.kind === 'RESULT')?.attemptCount).toBe(1);
      expect(cloud.sendMessage).toHaveBeenCalledTimes(2);
    });
    it('does not retry an expired claim left by a stopped worker', async () => {
      const f = await seed({ ready: true });
      await app.get(NitaV2CompletionService).prepare(accounts[0], f.id);
      const original = (await read(f.leadId)).quote;
      await prisma.whatsAppDelivery.updateMany({
        where: { leadId: f.leadId, kind: 'RESULT' },
        data: { claimId: randomUUID(), leaseUntil: new Date(Date.now() - 1000), attemptCount: 1 },
      });
      expect((await inbound()).status).toBe(200);
      expect((await inbound()).status).toBe(200);
      const lead = await read(f.leadId);
      expect(lead.quote).toEqual(original);
      expect(lead.deliveries.find((item) => item.kind === 'RESULT')?.lastErrorCode).toBe(
        'DELIVERY_UNKNOWN',
      );
      expect(cloud.sendMessage).not.toHaveBeenCalled();
    });
    it('does not retry an ambiguous booking question or resend its confirmed price', async () => {
      const f = await seed({ ready: true });
      const id = randomUUID();
      cloud.sendMessage
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('Question result unknown'));
      expect((await inbound(0, 'continuar', id)).status).toBe(200);
      expect((await inbound(0, 'continuar', id)).status).toBe(200);
      const lead = await read(f.leadId);
      expect(lead.conversation?.currentState).toBe('PRICE_READY');
      expect(lead.deliveries.find((item) => item.kind === 'RESULT')?.sentAt).not.toBeNull();
      expect(lead.deliveries.find((item) => item.kind === 'ADVANCE_INTENT')).toMatchObject({
        sentAt: null,
        lastErrorCode: 'DELIVERY_UNKNOWN',
        attemptCount: 1,
      });
      expect(cloud.sendMessage).toHaveBeenCalledTimes(2);
    });
    it('preserves the single Quote through real recalibration and dashboard operations', async () => {
      const f = await seed({ ready: true });
      expect((await inbound()).status).toBe(200);
      const original = (await read(f.leadId)).quote!;
      const cases = [
        { id: randomUUID(), type: 'AREA' as const, areaCm2: 20, colorCoverage: 0, price: 400 },
        { id: randomUUID(), type: 'AREA' as const, areaCm2: 100, colorCoverage: 0, price: 2000 },
        { id: randomUUID(), type: 'COLOR' as const, areaCm2: 50, colorCoverage: 1, price: 2000 },
      ];
      await prisma.calibrationCase.createMany({
        data: cases.map((item, displayOrder) => ({
          id: item.id,
          type: item.type,
          areaCm2: item.areaCm2,
          colorCoverage: item.colorCoverage,
          styleId,
          displayOrder,
          imageUrl: 'https://example.test/calibration.png',
        })),
      });
      const calibration = app.get(CalibrationService);
      await calibration.startDraft(accounts[0], styleId);
      for (const item of cases)
        await calibration.saveAnswer(accounts[0], styleId, item.id, item.price);
      const newModel = await calibration.activate(accounts[0], styleId);
      expect(newModel.id).not.toBe(original.pricingModelVersionId);
      expect(await calibration.calculatePrice(accounts[0], styleId, 50, 0.5)).toMatchObject({
        applicable: true,
        pricePen: '1650.00',
      });
      await calibration.setAdjustment(accounts[0], 50);
      expect(
        await prisma.$transaction((tx) =>
          app.get(QuoteV2Service).getOrCreate(tx, accounts[0], f.leadId),
        ),
      ).toEqual({ applicable: true, quote: original });
      await expect(
        prisma.quote.create({
          data: {
            leadId: f.leadId,
            accountId: accounts[0],
            pricingModelVersionId: newModel.id,
            amount: 1,
            targetAreaCm2: 50,
            targetColorCoverage: 0.5,
            detectedStyle: styleCode,
            generalAdjustmentPercent: 50,
            algorithmVersion: ALGORITHM_VERSION,
            snapshot: {},
          },
        }),
      ).rejects.toThrow();
      await expect(dashboard().saveManualFinalPrice(accounts[0], f.leadId, 1)).rejects.toThrow();
      await dashboard().archiveLead(accounts[0], f.leadId);
      await dashboard().restoreLead(accounts[0], f.leadId);
      await dashboard().completeLead(accounts[0], f.leadId);
      expect((await dashboard().getLead(accounts[0], f.leadId)).quote?.amount).toBe('825.00');
      expect((await read(f.leadId)).quote).toEqual(original);
      expect(await prisma.quote.count({ where: { leadId: f.leadId } })).toBe(1);
    });
    it('isolates prices, dashboard reads and booking ownership for two artists sharing a customer phone', async () => {
      const a = await seed({ ready: true }),
        b = await seed({ index: 1, ready: true });
      expect((await inbound(0)).status).toBe(200);
      expect((await inbound(1)).status).toBe(200);
      expect((await read(a.leadId)).quote?.amount.toFixed(2)).toBe('825.00');
      expect((await read(b.leadId)).quote?.amount.toFixed(2)).toBe('1650.00');
      expect((await read(b.leadId)).quote?.pricingModelVersionId).toBe(modelIds[1]);
      await expect(dashboard().getLead(accounts[0], b.leadId)).rejects.toThrow('No encontramos');
      await expect(app.get(NitaV2CompletionService).prepare(accounts[1], a.id)).rejects.toThrow(
        'no disponible',
      );
      await expect(
        prisma.$transaction((tx) => app.get(QuoteV2Service).getOrCreate(tx, accounts[1], a.leadId)),
      ).rejects.toThrow('no disponible');
      await expect(
        app
          .get(NitaV2CompletionService)
          .recordIntent(accounts[0], a.id, b.customerId, 'DIRECT_BOOKING'),
      ).rejects.toThrow('no disponible');
      expect(
        (
          await inbound(
            0,
            V2_BOOKING_BUTTON_IDS.DIRECT_BOOKING,
            randomUUID(),
            'button',
            '51900000006',
          )
        ).status,
      ).toBe(200);
      expect((await read(a.leadId)).bookingIntent).toBeNull();
      const detail = await dashboard().getLead(accounts[0], a.leadId);
      expect(detail).toMatchObject({
        quote: { amount: '825.00' },
        v2: { style: styleCode, targetAreaCm2: '50', targetColorCoverage: 0.5 },
      });
    });
    it('keeps V2 quote history when an artist finishes a lead and allows a fresh intake', async () => {
      const f = await seed({ ready: true });
      expect((await inbound()).status).toBe(200);
      const original = (await read(f.leadId)).quote;
      await dashboard().completeLead(accounts[0], f.leadId);
      expect((await dashboard().getLead(accounts[0], f.leadId)).deletable).toBe(false);
      await expect(dashboard().deleteIncompleteLead(accounts[0], f.leadId)).rejects.toThrow(
        'Solo se pueden eliminar',
      );
      expect((await inbound(0, 'hola')).status).toBe(200);
      const conversations = await prisma.conversation.findMany({
        where: { accountId: accounts[0], customerId: f.customerId },
        orderBy: { createdAt: 'desc' },
      });
      expect(conversations).toHaveLength(2);
      expect(conversations[0]).toMatchObject({
        currentState: 'ASK_FIRST_TATTOO',
        firstTattoo: null,
        sameSizeAsReference: null,
      });
      expect((await read(f.leadId)).quote).toEqual(original);
      expect(await storage.exists(f.path)).toBe(true);
    });
  },
);

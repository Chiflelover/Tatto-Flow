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
import { ChatbotService } from '../src/modules/chatbot/chatbot.service.js';
import { NitaBusinessHoursService } from '../src/modules/chatbot/nita-business-hours.service.js';
import { NitaV2IntakeService } from '../src/modules/chatbot/nita-v2-intake.service.js';
import { NitaV2AnalysisService } from '../src/modules/chatbot/nita-v2-analysis.service.js';
import { WHATSAPP_BUTTON_IDS as Buttons } from '../src/modules/chatbot/whatsapp/whatsapp.adapter.js';
import { ConversationAbandonmentService } from '../src/modules/conversations/conversation-abandonment.service.js';
import { ImageAnalysisWorkflowService } from '../src/modules/image-analysis/image-analysis-workflow.service.js';
import { ImageAnalysisV2Service } from '../src/modules/image-analysis/image-analysis-v2.service.js';
import { ImageManagementService } from '../src/modules/image-management/image-management.service.js';
import { StorageService } from '../src/modules/storage/storage.service.js';
import { WhatsAppCloudApiClient } from '../src/modules/whatsapp/whatsapp-cloud-api.client.js';
import { WhatsAppModule } from '../src/modules/whatsapp/whatsapp.module.js';
import { VISION_IMAGE } from './fixtures/vision-v2.js';

// Explicit opt-in for the configured development DB. All test rows are isolated and removed.
describe.runIf(process.env.RUN_NITA_V2_DB_TESTS === '1')(
  'Nita V2 with development DB and simulated WhatsApp (e2e)',
  { timeout: 30_000 },
  () => {
    let app: INestApplication<Server>;
    let prisma: PrismaService;
    const accountA = randomUUID();
    const accountB = randomUUID();
    const accounts = [accountA, accountB];
    const phoneA = `4${Date.now()}1`;
    const phoneB = `4${Date.now()}2`;
    const customerPhone = '51900000001';
    const appSecret = randomUUID();
    const messageIds: string[] = [];
    const cloud = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
      downloadImage: vi.fn().mockResolvedValue(VISION_IMAGE),
    };
    const v1Analysis = vi.fn();
    const v2Analysis = vi.fn();

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
        .overrideProvider(WhatsAppCloudApiClient)
        .useValue(cloud)
        .overrideProvider(NitaBusinessHoursService)
        .useValue({ isOpen: () => true })
        // Intake-only coverage. The full preparation workflow has its own E2E suite.
        .overrideProvider(NitaV2AnalysisService)
        .useValue({
          resumePendingForCustomer: vi.fn().mockResolvedValue(undefined),
          process: (accountId: string, id: string) =>
            prisma.conversation.findFirstOrThrow({ where: { id, accountId } }),
        })
        .compile();
      app = module.createNestApplication<INestApplication<Server>>({ rawBody: true });
      app.setGlobalPrefix('api');
      app.useLogger(false);
      await app.init();
      prisma = app.get(PrismaService);
      for (const [index, id] of accounts.entries()) {
        await prisma.tattooArtistAccount.create({
          data: {
            id,
            name: `Phase 4A test ${index}`,
            channel: {
              create: {
                phoneNumberId: index === 0 ? phoneA : phoneB,
                phoneNumber: index === 0 ? phoneA : phoneB,
              },
            },
          },
        });
      }
      vi.spyOn(
        app.get(ImageAnalysisWorkflowService),
        'analyzeConversationImage',
      ).mockImplementation(v1Analysis);
      vi.spyOn(app.get(ImageAnalysisV2Service), 'analyzeReference').mockImplementation(v2Analysis);
    }, 30_000);

    afterEach(async () => {
      if (!prisma) return;
      try {
        expect(v1Analysis).not.toHaveBeenCalled();
        expect(v2Analysis).not.toHaveBeenCalled();
      } finally {
        // Cleanup is scoped to generated test account IDs; reference files live only in memory.
        await prisma.lead.deleteMany({ where: { accountId: { in: accounts } } });
        await prisma.conversation.deleteMany({ where: { accountId: { in: accounts } } });
        await prisma.customer.deleteMany({ where: { accountId: { in: accounts } } });
        await prisma.whatsAppInboundMessage.deleteMany({
          where: { messageId: { in: messageIds } },
        });
        await prisma.tattooArtistAccount.updateMany({
          where: { id: { in: accounts } },
          data: { isActive: true },
        });
        vi.clearAllMocks();
        app.get(ConfigService).set('NITA_DEFAULT_FLOW_VERSION', 'V2');
      }
    }, 30_000);
    afterAll(async () => {
      if (prisma) {
        await prisma.whatsAppChannel.deleteMany({ where: { accountId: { in: accounts } } });
        await prisma.tattooArtistAccount.deleteMany({ where: { id: { in: accounts } } });
      }
      if (app) await app.close();
    }, 30_000);

    async function inbound(
      type: 'text' | 'button' | 'image',
      value: string,
      receivingPhone = phoneA,
      id = randomUUID(),
    ) {
      messageIds.push(id);
      const message = {
        id,
        from: customerPhone,
        type: type === 'button' ? 'interactive' : type,
        ...(type === 'text'
          ? { text: { body: value } }
          : type === 'image'
            ? { image: { id: value } }
            : { interactive: { type: 'button_reply', button_reply: { id: value } } }),
      };
      const body = JSON.stringify({
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'test-business',
            changes: [
              {
                field: 'messages',
                value: { metadata: { phone_number_id: receivingPhone }, messages: [message] },
              },
            ],
          },
        ],
      });
      const signature = `sha256=${createHmac('sha256', appSecret).update(body).digest('hex')}`;
      await request(app.getHttpServer())
        .post('/api/whatsapp/webhook')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', signature)
        .send(body)
        .expect(200);
    }
    async function current(accountId = accountA) {
      return prisma.conversation.findFirstOrThrow({
        where: { accountId },
        include: { lead: { include: { images: true, aiAnalysis: true, evaluation: true } } },
      });
    }
    async function reference(sameSize: boolean) {
      await inbound('text', 'Hola');
      expect((await current()).currentState).toBe('ASK_FIRST_TATTOO');
      expect(await prisma.lead.count({ where: { accountId: accountA } })).toBe(0);
      await inbound('button', Buttons.FIRST_TATTOO_NO);
      await inbound('image', 'test-reference');
      expect((await current()).currentState).toBe('ASK_SAME_SIZE');
      await inbound('button', sameSize ? Buttons.SAME_SIZE_YES : Buttons.SAME_SIZE_NO);
    }

    it.each([Buttons.COLOR_BLACK_ONLY, Buttons.COLOR_SOME, Buttons.COLOR_MOSTLY])(
      'completes SAME_SIZE and persists %s without AI or pricing',
      async (button) => {
        await reference(true);
        expect((await current()).currentState).toBe('ASK_COLOR');
        await inbound('button', button);
        await inbound('text', 'Antebrazo izquierdo');
        const conversation = await current();
        const color =
          button === Buttons.COLOR_BLACK_ONLY
            ? 'BLACK_ONLY'
            : button === Buttons.COLOR_SOME
              ? 'BLACK_WITH_SOME_COLOR'
              : 'MOSTLY_COLOR';
        expect(conversation).toMatchObject({
          flowVersion: 'V2',
          currentState: 'READY_FOR_ANALYSIS',
          firstTattoo: false,
          sameSizeAsReference: true,
          targetSizeCm: null,
          colorDeclaration: color,
          bodyPart: 'Antebrazo izquierdo',
        });
        expect(conversation.lead).toMatchObject({
          accountId: accountA,
          firstTattoo: false,
          sameSizeAsReference: true,
          targetSizeCm: null,
          colorDeclaration: color,
          bodyPart: 'Antebrazo izquierdo',
          aiAnalysis: null,
          evaluation: null,
          calculatedMinPrice: null,
          calculatedMaxPrice: null,
          pricingRuleId: null,
        });
        expect(conversation.lead?.images).toHaveLength(1);
        expect(await app.get(StorageService).exists(conversation.lead!.images[0].storagePath)).toBe(
          true,
        );
      },
    );
    it('completes DIFFERENT_SIZE after invalid retries and textual Black & Grey fallback', async () => {
      await reference(false);
      for (const value of ['0', '-8', '8 x 10 cm', '8 pulgadas']) {
        await inbound('text', value);
        expect((await current()).currentState).toBe('ASK_DESIRED_SIZE_CM');
      }
      await inbound('text', '12.5 cm');
      await inbound('text', 'Black & Grey');
      await inbound('text', 'Espalda superior derecha');
      expect((await current()).lead).toMatchObject({
        firstTattoo: false,
        sameSizeAsReference: false,
        targetSizeCm: 12.5,
        colorDeclaration: 'BLACK_ONLY',
        bodyPart: 'Espalda superior derecha',
        aiAnalysis: null,
      });
      expect((await current()).currentState).toBe('READY_FOR_ANALYSIS');
    });
    it('ignores duplicate messages, repeated images and earlier buttons', async () => {
      await inbound('text', 'Hola');
      const replyId = randomUUID();
      await inbound('button', Buttons.FIRST_TATTOO_YES, phoneA, replyId);
      await inbound('button', Buttons.FIRST_TATTOO_YES, phoneA, replyId);
      await inbound('text', 'necesito una referencia');
      expect((await current()).currentState).toBe('WAITING_IMAGE');
      const imageId = randomUUID();
      await inbound('image', 'reference', phoneA, imageId);
      await inbound('image', 'reference', phoneA, imageId);
      await inbound('image', 'reference-again');
      await inbound('button', Buttons.FIRST_TATTOO_NO);
      expect((await current()).currentState).toBe('ASK_SAME_SIZE');
      expect((await current()).lead?.images).toHaveLength(1);
      expect(await prisma.lead.count({ where: { accountId: accountA } })).toBe(1);
    });
    it('serializes simultaneous references into a single lead and image', async () => {
      await inbound('text', 'Hola');
      await inbound('button', Buttons.FIRST_TATTOO_YES);
      const chatbot = app.get(ChatbotService);
      await Promise.all([
        chatbot.processImageMessage(accountA, customerPhone, VISION_IMAGE),
        chatbot.processImageMessage(accountA, customerPhone, VISION_IMAGE),
      ]);
      expect((await current()).lead?.images).toHaveLength(1);
      expect((await current()).currentState).toBe('ASK_SAME_SIZE');
    });
    it('rolls back candidate and state on storage failure, then accepts retry', async () => {
      await inbound('text', 'Hola');
      await inbound('button', Buttons.FIRST_TATTOO_YES);
      vi.spyOn(app.get(StorageService), 'upload').mockRejectedValueOnce(new Error('test failure'));
      await inbound('image', 'failed-reference');
      expect((await current()).currentState).toBe('WAITING_IMAGE');
      expect((await current()).lead).toBeNull();
      await inbound('image', 'retry');
      expect((await current()).lead?.images).toHaveLength(1);
    });
    it('resolves two channels and isolates the same customer phone across accounts', async () => {
      await inbound('text', 'Hola', phoneA);
      await inbound('text', 'Hola', phoneB);
      await inbound('button', Buttons.FIRST_TATTOO_YES, phoneA);
      const a = await current(accountA);
      const b = await current(accountB);
      expect(a.accountId).toBe(accountA);
      expect(b.accountId).toBe(accountB);
      expect(a.customerId).not.toBe(b.customerId);
      expect(a.currentState).toBe('WAITING_IMAGE');
      expect(b.currentState).toBe('ASK_FIRST_TATTOO');
      expect(cloud.sendMessage.mock.calls.some(([phone]: unknown[]) => phone === phoneA)).toBe(
        true,
      );
      expect(cloud.sendMessage.mock.calls.some(([phone]: unknown[]) => phone === phoneB)).toBe(
        true,
      );
      await expect(
        app.get(NitaV2IntakeService).storeReference(accountB, a.id, VISION_IMAGE),
      ).rejects.toThrow('esta cuenta');
    });
    it('does not start or continue through a disabled channel', async () => {
      await inbound('text', 'Hola', phoneA);
      await prisma.tattooArtistAccount.update({
        where: { id: accountA },
        data: { isActive: false },
      });
      await prisma.tattooArtistAccount.update({
        where: { id: accountB },
        data: { isActive: false },
      });
      await inbound('button', Buttons.FIRST_TATTOO_YES, phoneA);
      await inbound('text', 'Hola', phoneB);
      expect((await current(accountA)).currentState).toBe('ASK_FIRST_TATTOO');
      expect(await prisma.conversation.count({ where: { accountId: accountB } })).toBe(0);
    });
    it('keeps an existing V1 conversation in V1 even when new conversations default to V2', async () => {
      const customer = await prisma.customer.create({
        data: { accountId: accountA, phoneNumber: customerPhone },
      });
      await prisma.conversation.create({
        data: {
          accountId: accountA,
          customerId: customer.id,
          flowVersion: 'V1',
          currentState: 'ASK_SIZE',
        },
      });
      await inbound('button', Buttons.SIZE_SMALL);
      expect(await current()).toMatchObject({
        flowVersion: 'V1',
        currentState: 'ASK_DETAIL',
        selectedSize: 'SMALL',
      });
    });
    it('abandons partial V2 intake without deleting the image or scoring it as V1', async () => {
      await reference(false);
      await inbound('text', '8 cm');
      const conversation = await current();
      const later = new Date(Date.now() + 24 * 60 * 60 * 1000);
      expect(
        await app
          .get(ConversationAbandonmentService)
          .abandonInactiveForCustomer(conversation.customerId, later),
      ).toBe(1);
      const abandoned = await current();
      expect(abandoned.status).toBe('ABANDONED');
      expect(abandoned.lead).toMatchObject({
        targetSizeCm: 8,
        firstTattoo: false,
        evaluation: null,
        aiAnalysis: null,
      });
      expect(abandoned.lead?.images[0]?.deletedAt).toBeNull();
    });

    it.each(['V2', 'V1'] as const)(
      'restarts abandoned V2 from zero with global default=%s, retains its ADMIN image and ignores retries',
      async (defaultFlow) => {
        await reference(false);
        await inbound('text', '12.5 cm');
        await inbound('button', Buttons.COLOR_SOME);
        await inbound('text', 'Antebrazo izquierdo');
        const original = await current();
        expect(original.currentState).toBe('READY_FOR_ANALYSIS');
        expect(original.lead?.images).toHaveLength(1);
        const retainedImage = original.lead!.images[0];
        const later = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const abandonment = app.get(ConversationAbandonmentService);
        expect(await abandonment.abandonInactiveForCustomer(original.customerId, later)).toBe(1);
        expect(await abandonment.abandonInactiveForCustomer(original.customerId, later)).toBe(0);
        const history = await prisma.conversation.findUniqueOrThrow({
          where: { id: original.id },
          include: { lead: { include: { images: true } } },
        });
        expect(history).toMatchObject({
          status: 'ABANDONED',
          firstTattoo: false,
          sameSizeAsReference: false,
          targetSizeCm: 12.5,
          colorDeclaration: 'BLACK_WITH_SOME_COLOR',
          bodyPart: 'Antebrazo izquierdo',
        });
        expect(
          await app
            .get(NitaV2IntakeService)
            .applyTransition(accountA, original.id, original.currentState, {
              currentState: 'ASK_FIRST_TATTOO',
            }),
        ).toMatchObject({ applied: false });
        expect(
          await app.get(NitaV2IntakeService).storeReference(accountA, original.id, VISION_IMAGE),
        ).toMatchObject({ applied: false });

        app.get(ConfigService).set('NITA_DEFAULT_FLOW_VERSION', defaultFlow);
        const returnId = randomUUID();
        await Promise.all([
          inbound('text', 'Hola otra vez', phoneA, returnId),
          inbound('text', 'Hola otra vez', phoneA, returnId),
        ]);
        await inbound('text', 'Hola otra vez');
        const fresh = await prisma.conversation.findFirstOrThrow({
          where: { accountId: accountA, status: 'ACTIVE' },
          include: { lead: { include: { images: true } } },
        });
        expect(fresh.id).not.toBe(original.id);
        expect(fresh).toMatchObject({
          flowVersion: 'V2',
          currentState: 'ASK_FIRST_TATTOO',
          firstTattoo: null,
          sameSizeAsReference: null,
          targetSizeCm: null,
          colorDeclaration: null,
          bodyPart: null,
          selectedSize: null,
          selectedDetail: null,
          lead: null,
        });
        expect(await prisma.conversation.count({ where: { accountId: accountA } })).toBe(2);
        expect(
          await prisma.conversation.count({ where: { accountId: accountA, status: 'ACTIVE' } }),
        ).toBe(1);
        expect(await prisma.lead.count({ where: { accountId: accountA } })).toBe(1);

        const storage = app.get(StorageService);
        const images = new ImageManagementService(prisma, storage);
        expect(await storage.exists(retainedImage.storagePath)).toBe(true);
        const visible = await images.listAll({ accountId: accountA, page: 1, pageSize: 50 });
        expect(visible.images).toHaveLength(1);
        expect(visible.images[0]).toMatchObject({
          id: retainedImage.id,
          leadId: original.lead!.id,
        });
        expect(visible.images[0]?.previewUrl).toEqual(expect.any(String));

        await inbound('button', Buttons.FIRST_TATTOO_YES);
        const newImageMessage = randomUUID();
        await inbound('image', 'new-reference', phoneA, newImageMessage);
        await inbound('image', 'new-reference', phoneA, newImageMessage);
        const newLead = await prisma.lead.findUniqueOrThrow({
          where: { conversationId: fresh.id },
          include: { images: true },
        });
        expect(newLead.images).toHaveLength(1);
        expect(newLead.images[0]?.id).not.toBe(retainedImage.id);
        expect(newLead.images[0]?.storagePath).not.toBe(retainedImage.storagePath);
        expect(await prisma.lead.count({ where: { accountId: accountA } })).toBe(2);
        expect(
          await prisma.conversation.findUniqueOrThrow({
            where: { id: original.id },
            include: { lead: { include: { images: true } } },
          }),
        ).toEqual(history);
        expect(await storage.exists(retainedImage.storagePath)).toBe(true);
        expect(
          (await images.listAll({ accountId: accountA, page: 1, pageSize: 50 })).images.map(
            (image) => image.id,
          ),
        ).toContain(retainedImage.id);
      },
      60_000,
    );
  },
);

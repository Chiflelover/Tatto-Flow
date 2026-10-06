import { WhatsAppJobDispatcher } from '../src/modules/whatsapp/whatsapp-job-dispatcher.service.js';
import { WhatsAppJobProcessor } from '../src/modules/whatsapp/whatsapp-job-processor.service.js';
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
import { ChatbotService } from '../src/modules/chatbot/chatbot.service.js';
import { NitaBusinessHoursService } from '../src/modules/chatbot/nita-business-hours.service.js';
import { NitaV2IntakeService } from '../src/modules/chatbot/nita-v2-intake.service.js';
import { NitaV2AnalysisService } from '../src/modules/chatbot/nita-v2-analysis.service.js';
import { NitaV2CompletionService } from '../src/modules/chatbot/nita-v2-completion.service.js';
import { WHATSAPP_BUTTON_IDS as Buttons } from '../src/modules/chatbot/whatsapp/whatsapp.adapter.js';
import { ConversationAbandonmentService } from '../src/modules/conversations/conversation-abandonment.service.js';
import { ImageAnalysisV2Service } from '../src/modules/image-analysis/image-analysis-v2.service.js';
import { ImageManagementService } from '../src/modules/image-management/image-management.service.js';
import { StorageService } from '../src/modules/storage/storage.service.js';
import { WhatsAppCloudApiClient } from '../src/modules/whatsapp/whatsapp-cloud-api.client.js';
import { WhatsAppModule } from '../src/modules/whatsapp/whatsapp.module.js';
import { VISION_IMAGE } from './fixtures/vision-v2.js';

// Explicit opt-in for the configured development DB. All test rows are isolated and removed.
describe.runIf(process.env.RUN_NITA_V2_DB_TESTS === '1')(
  'Nita V2 with isolated DB and simulated WhatsApp (e2e)',
  { timeout: 120_000 },
  () => {
    let app: INestApplication<Server>;
    let prisma: PrismaService;
    let database: Awaited<ReturnType<typeof isolatedDatabase>>;
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

    const v2Analysis = vi.fn();

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
                  CRON_SECRET: appSecret.repeat(3),
                }),
            ],
          }),
          PrismaModule,
          WhatsAppModule,
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
        // Intake-only coverage. The full preparation workflow has its own E2E suite.
        .overrideProvider(NitaV2AnalysisService)
        .useValue({
          resumePendingForCustomer: vi.fn().mockResolvedValue(undefined),
          process: (accountId: string, id: string) =>
            prisma.conversation.findFirstOrThrow({ where: { id, accountId } }),
        })
        .overrideProvider(NitaV2CompletionService)
        .useValue({
          prepare: (accountId: string, id: string) =>
            prisma.conversation.findFirstOrThrow({ where: { id, accountId } }),
          resumePendingForCustomer: vi.fn().mockResolvedValue(undefined),
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
      vi.spyOn(app.get(ImageAnalysisV2Service), 'analyzeReference').mockImplementation(v2Analysis);
    }, 120_000);

    afterEach(async () => {
      if (!prisma) return;
      try {
        expect(v2Analysis).not.toHaveBeenCalled();
      } finally {
        // Cleanup is scoped to generated test account IDs; reference files live only in memory.
        await prisma.whatsAppJob.deleteMany({ where: { accountId: { in: accounts } } });
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
      }
    }, 120_000);
    afterAll(async () => {
      if (prisma) {
        await prisma.whatsAppChannel.deleteMany({ where: { accountId: { in: accounts } } });
        await prisma.tattooArtistAccount.deleteMany({ where: { id: { in: accounts } } });
      }
      if (app) await app.close();
      if (database) await database.close();
    }, 120_000);

    async function inbound(
      type: 'text' | 'button' | 'list' | 'image',
      value: string,
      receivingPhone = phoneA,
      id = randomUUID(),
    ) {
      messageIds.push(id);
      const message = {
        id,
        from: customerPhone,
        type: type === 'button' || type === 'list' ? 'interactive' : type,
        ...(type === 'text'
          ? { text: { body: value } }
          : type === 'image'
            ? { image: { id: value } }
            : type === 'list'
              ? { interactive: { type: 'list_reply', list_reply: { id: value } } }
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
      const accountId = receivingPhone === phoneA ? accountA : accountB;
      while ((await app.get(WhatsAppJobProcessor).runNext(accountId)).processed) {
        // Drain the durable queue without starting background workers.
      }
    }
    async function current(accountId = accountA) {
      return prisma.conversation.findFirstOrThrow({
        where: { accountId },
        include: { lead: { include: { images: true, aiAnalysis: true } } },
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

    it.each([
      [Buttons.COLOR_BLACK_ONLY, 'BLACK_ONLY'],
      [Buttons.COLOR_LOW, 'LOW_COLOR'],
      [Buttons.COLOR_MEDIUM, 'MEDIUM_COLOR'],
      [Buttons.COLOR_FULL, 'FULL_COLOR'],
    ] as const)(
      'completes SAME_SIZE and persists %s without AI or pricing',
      async (button, color) => {
        await reference(true);
        expect((await current()).currentState).toBe('ASK_DESIRED_SIZE_CM');
        expect((await current()).targetSizeCm).toBeNull();
        await inbound('list', button);
        expect((await current()).currentState).toBe('ASK_DESIRED_SIZE_CM');
        await inbound('text', '12.5 cm');
        expect((await current()).currentState).toBe('ASK_COLOR');
        expect(cloud.sendMessage).toHaveBeenLastCalledWith(
          phoneA,
          customerPhone,
          {
            type: 'interactive_list',
            body: '¿Qué nivel de color quieres para tu tatuaje?',
            button: 'Elegir color',
            rows: [
              { id: Buttons.COLOR_BLACK_ONLY, title: 'Negro' },
              { id: Buttons.COLOR_LOW, title: 'Poco color' },
              { id: Buttons.COLOR_MEDIUM, title: 'Color medio' },
              { id: Buttons.COLOR_FULL, title: 'Full color' },
            ],
          },
          expect.any(AbortSignal),
        );
        await inbound('list', button);
        await inbound('text', 'Antebrazo izquierdo');
        const conversation = await current();
        expect(conversation).toMatchObject({
          currentState: 'READY_FOR_ANALYSIS',
          firstTattoo: false,
          sameSizeAsReference: true,
          targetSizeCm: 12.5,
          colorDeclaration: color,
          bodyPart: 'Antebrazo izquierdo',
        });
        expect(conversation.lead).toMatchObject({
          accountId: accountA,
          firstTattoo: false,
          sameSizeAsReference: true,
          targetSizeCm: 12.5,
          colorDeclaration: color,
          bodyPart: 'Antebrazo izquierdo',
          aiAnalysis: null,
        });
        expect(conversation.lead?.images).toHaveLength(1);
        expect(await app.get(StorageService).exists(conversation.lead!.images[0].storagePath)).toBe(
          true,
        );
      },
    );
    it('completes DIFFERENT_SIZE after invalid retries and textual Black & Grey fallback', async () => {
      await reference(false);
      expect((await current()).currentState).toBe('ASK_DESIRED_SIZE_CM');
      for (const value of ['0', '-8', '8 x 10 cm', '8 pulgadas']) {
        await inbound('text', value);
        expect((await current()).currentState).toBe('ASK_DESIRED_SIZE_CM');
      }
      await inbound('text', '12.5 cm');
      expect((await current()).currentState).toBe('ASK_COLOR');
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
      const imageId = randomUUID();
      await inbound('image', 'failed-reference', phoneA, imageId);
      expect((await current()).currentState).toBe('WAITING_IMAGE');
      expect((await current()).lead).toBeNull();
      // Preserve queue ordering and retry the same durable event after its backoff.
      await prisma.whatsAppJob.updateMany({
        where: { inboundMessageId: imageId, status: 'RETRYABLE' },
        data: { availableAt: new Date(Date.now() - 1000) },
      });
      await inbound('image', 'failed-reference', phoneA, imageId);
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
    it('abandons partial V2 intake without deleting the image', async () => {
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

        aiAnalysis: null,
      });
      expect(abandoned.lead?.images[0]?.deletedAt).toBeNull();
    });

    it('sweeps only expired intake while preserving another account with the same phone', async () => {
      await inbound('text', 'Hola', phoneA);
      await inbound('text', 'Hola', phoneB);
      const original = await current(accountA);
      const anotherAccount = await current(accountB);
      expect(original.customerId).not.toBe(anotherAccount.customerId);
      await prisma.conversation.update({
        where: { id: original.id },
        data: { lastActivityAt: new Date(Date.now() - 2 * 60 * 60 * 1_000 - 1) },
      });

      await request(app.getHttpServer()).get('/api/conversations/abandon-inactive').expect(401);
      expect((await current(accountA)).status).toBe('ACTIVE');
      const sweeps = await Promise.all(
        [0, 1].map(() =>
          request(app.getHttpServer())
            .get('/api/conversations/abandon-inactive')
            .set('Authorization', `Bearer ${appSecret.repeat(3)}`)
            .expect(200),
        ),
      );
      expect(
        sweeps.map(({ body }) => (body as { abandonedCount: number }).abandonedCount).sort(),
      ).toEqual([0, 1]);
      const history = await current(accountA);
      expect(history.status).toBe('ABANDONED');
      expect(history.lead).toMatchObject({ accountId: accountA, customerId: original.customerId });
      expect(await current(accountB)).toEqual(anotherAccount);
      expect(await prisma.lead.count({ where: { accountId: accountB } })).toBe(0);
    });

    it('restarts abandoned intake from zero, retains its ADMIN image and ignores retries', async () => {
      await reference(false);
      await inbound('text', '12.5 cm');
      await inbound('list', Buttons.COLOR_LOW);
      await inbound('text', 'Antebrazo izquierdo');
      const original = await current();
      expect(original.currentState).toBe('READY_FOR_ANALYSIS');
      expect(original.lead?.images).toHaveLength(1);
      const retainedImage = original.lead!.images[0];
      await prisma.conversation.update({
        where: { id: original.id },
        data: { lastActivityAt: new Date(Date.now() - 2 * 60 * 60 * 1_000 - 1) },
      });
      for (const abandonedCount of [1, 0]) {
        await request(app.getHttpServer())
          .get('/api/conversations/abandon-inactive')
          .set('Authorization', `Bearer ${appSecret.repeat(3)}`)
          .expect(200, { abandonedCount });
      }
      const history = await prisma.conversation.findUniqueOrThrow({
        where: { id: original.id },
        include: { lead: { include: { images: true } } },
      });
      expect(history).toMatchObject({
        status: 'ABANDONED',
        firstTattoo: false,
        sameSizeAsReference: false,
        targetSizeCm: 12.5,
        colorDeclaration: 'LOW_COLOR',
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
        currentState: 'ASK_FIRST_TATTOO',
        firstTattoo: null,
        sameSizeAsReference: null,
        targetSizeCm: null,
        colorDeclaration: null,
        bodyPart: null,
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
    }, 180_000);
  },
);

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { UserRole, type ColorDeclaration } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { AdminGuard, TattooArtistGuard } from '../src/modules/auth/role.guard.js';
import { SessionAuthGuard } from '../src/modules/auth/session-auth.guard.js';
import { CalibrationController } from '../src/modules/calibration/calibration.controller.js';
import { CalibrationService } from '../src/modules/calibration/calibration.service.js';
import { CatalogController } from '../src/modules/calibration/catalog.controller.js';
import { CatalogService } from '../src/modules/calibration/catalog.service.js';
import { CatalogImportService } from '../src/modules/calibration/catalog-import.service.js';
import { readCatalogImport } from '../src/modules/calibration/catalog-import-files.js';
import { buildModel } from '../src/modules/calibration/model-interpolation.js';
import { CATALOG_AB_ALGORITHM_VERSION } from '../src/modules/calibration/catalog-ab-interpolation.js';
import { catalogABPricingFixture } from './fixtures/catalog-ab-pricing.js';
import { persistedVision } from './fixtures/vision-v2.js';
import { QuoteV2Service } from '../src/modules/pricing/quote-v2.service.js';
import { prepareV2Case } from '../src/modules/chatbot/domain/nita-v2-decision.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { catalogManifestFixture } from './fixtures/calibration-catalog.js';
import { isolatedDatabase } from './helpers/isolated-database.js';

describe.runIf(process.env.RUN_CALIBRATION_DB_TESTS === '1')(
  'global catalog, migration and account isolation (PostgreSQL E2E)',
  { timeout: 30_000 },
  () => {
    let database: Awaited<ReturnType<typeof isolatedDatabase>>;
    let app: INestApplication<Server>;
    let service: CalibrationService;
    const accountA = randomUUID(),
      accountB = randomUUID(),
      accountC = randomUUID();
    const styleId = randomUUID(),
      historicalModelId = randomUUID(),
      historicalDraftId = randomUUID();
    const idwModelId = randomUUID();
    const retiredFineLineModelId = randomUUID();
    const retiredFineLineDraftId = randomUUID();
    const retiredFineLineQuoteId = randomUUID();
    const retiredFineLineCases = [
      ...[25, 50, 100, 150, 220].map((areaCm2, index) => ({
        id: randomUUID(),
        imageUrl: `https://catalog.test.invalid/retired-fine-area-${index}.png`,
        type: 'AREA' as const,
        areaCm2,
        colorCoverage: 0,
        displayOrder: index + 1,
      })),
      ...[0.2, 0.4, 0.7, 1].map((colorCoverage, index) => ({
        id: randomUUID(),
        imageUrl: `https://catalog.test.invalid/retired-fine-color-${index}.png`,
        type: 'COLOR' as const,
        areaCm2: 50,
        colorCoverage,
        displayOrder: index + 6,
      })),
    ];
    const retiredFineLinePrices = ['100', '150', '200', '300', '400', '180', '200', '250', '300'];
    const retiredFineLineParameters = buildModel(
      retiredFineLineCases.map((item, index) => ({
        ...item,
        caseId: item.id,
        pricePen: retiredFineLinePrices[index],
      })),
    );
    const retiredFineLineQuoteSnapshot = {
      version: 2,
      calibrationCases: retiredFineLineCases,
      modelParameters: retiredFineLineParameters,
      targetAreaCm2: '25',
      targetColorCoverage: 0,
    };
    let fineLineId: string;
    let fineLineRoute: string;
    const legacyCases = [
      {
        id: randomUUID(),
        imageUrl: 'https://catalog.test.invalid/old-area-1.png',
        type: 'AREA' as const,
        areaCm2: 10,
        colorCoverage: 0,
        displayOrder: 1,
      },
      {
        id: randomUUID(),
        imageUrl: 'https://catalog.test.invalid/old-area-2.png',
        type: 'AREA' as const,
        areaCm2: 100,
        colorCoverage: 0,
        displayOrder: 2,
      },
      {
        id: randomUUID(),
        imageUrl: 'https://catalog.test.invalid/old-color.png',
        type: 'COLOR' as const,
        areaCm2: 10,
        colorCoverage: 1,
        displayOrder: 3,
      },
    ];
    const prices = ['100.00', '1000.00', '200.00'];
    const parameters = buildModel(
      legacyCases.map((item, index) => ({ ...item, caseId: item.id, pricePen: prices[index] })),
    );
    const idwParameters = { algorithm: 'IDW_CONVEX_HULL_V1', points: [] };
    const manifest = catalogManifestFixture();
    const api = () => request(app.getHttpServer());
    const route = `/api/dashboard/calibration/styles/${styleId}`;
    const historicalColors = ['BLACK_WITH_SOME_COLOR', 'MOSTLY_COLOR'].map((colorDeclaration) => ({
      colorDeclaration,
      customerId: randomUUID(),
      conversationId: randomUUID(),
      leadId: randomUUID(),
    }));

    beforeAll(async () => {
      database = await isolatedDatabase(async (name, client) => {
        if (name === '20261006210000_retire_fine_line_area_color_catalog') {
          fineLineId = (
            await client.query<{ id: string }>(
              "SELECT id FROM tattoo_styles WHERE code = 'FINE_LINE'",
            )
          ).rows[0].id;
          for (const item of retiredFineLineCases)
            await client.query(
              'INSERT INTO calibration_cases (id, style_id, image_url, type, area_cm2, color_coverage, display_order) VALUES ($1,$2,$3,$4,$5,$6,$7)',
              [
                item.id,
                fineLineId,
                item.imageUrl,
                item.type,
                item.areaCm2,
                item.colorCoverage,
                item.displayOrder,
              ],
            );
          for (const [id, version, status, modelParameters] of [
            [retiredFineLineModelId, 1, 'ACTIVE', retiredFineLineParameters],
            [retiredFineLineDraftId, 2, 'DRAFT', null],
          ] as const)
            await client.query(
              'INSERT INTO pricing_model_versions (id, account_id, style_id, version, status, case_snapshot, model_parameters) VALUES ($1,$2,$3,$4,$5,$6,$7)',
              [
                id,
                accountA,
                fineLineId,
                version,
                status,
                JSON.stringify(retiredFineLineCases),
                modelParameters ? JSON.stringify(modelParameters) : null,
              ],
            );
          for (const [index, item] of retiredFineLineCases.entries())
            await client.query(
              'INSERT INTO calibration_answers (id, model_version_id, case_id, price_pen) VALUES ($1,$2,$3,$4)',
              [randomUUID(), retiredFineLineModelId, item.id, retiredFineLinePrices[index]],
            );
          const customerId = randomUUID(),
            leadId = randomUUID();
          await client.query(
            'INSERT INTO customers (id, account_id, phone_number, updated_at) VALUES ($1,$2,$3,now())',
            [customerId, accountA, '51900000888'],
          );
          await client.query(
            'INSERT INTO leads (id, account_id, customer_id, updated_at) VALUES ($1,$2,$3,now())',
            [leadId, accountA, customerId],
          );
          await client.query(
            'INSERT INTO quotes (id, lead_id, account_id, pricing_model_version_id, amount, target_area_cm2, target_color_coverage, detected_style, general_adjustment_percent, algorithm_version, snapshot) VALUES ($1,$2,$3,$4,100,25,0,$5,0,$6,$7)',
            [
              retiredFineLineQuoteId,
              leadId,
              accountA,
              retiredFineLineModelId,
              'FINE_LINE',
              'AREA_COLOR_SEPARABLE_V1',
              JSON.stringify(retiredFineLineQuoteSnapshot),
            ],
          );
          return;
        }
        if (name === '20261006190000_add_explicit_color_levels') {
          for (const [index, item] of historicalColors.entries()) {
            await client.query(
              'INSERT INTO customers (id, account_id, phone_number, updated_at) VALUES ($1, $2, $3, now())',
              [item.customerId, accountA, `5190000094${index}`],
            );
            await client.query(
              'INSERT INTO conversations (id, account_id, customer_id, current_state, first_tattoo, same_size_as_reference, target_size_cm, color_declaration, body_part, updated_at) VALUES ($1, $2, $3, $4, false, true, 11, $5, $6, now())',
              [
                item.conversationId,
                accountA,
                item.customerId,
                'READY_FOR_ANALYSIS',
                item.colorDeclaration,
                'Brazo',
              ],
            );
            await client.query(
              'INSERT INTO leads (id, account_id, customer_id, conversation_id, color_declaration, updated_at) VALUES ($1, $2, $3, $4, $5, now())',
              [item.leadId, accountA, item.customerId, item.conversationId, item.colorDeclaration],
            );
          }
          return;
        }
        if (name !== '20261002210000_add_global_calibration_catalog') return;
        for (const id of [accountA, accountB, accountC])
          await client.query(
            'INSERT INTO tattoo_artist_accounts (id, name, updated_at) VALUES ($1, $2, now())',
            [id, 'Catalog test account'],
          );
        await client.query('INSERT INTO tattoo_styles (id, code, name) VALUES ($1, $2, $3)', [
          styleId,
          'TEST_STYLE',
          'Catalog test style',
        ]);
        for (const id of [accountA, accountB, accountC])
          await client.query('INSERT INTO artist_styles (account_id, style_id) VALUES ($1, $2)', [
            id,
            styleId,
          ]);
        for (const item of legacyCases)
          await client.query(
            'INSERT INTO calibration_cases (id, style_id, image_url, type, area_cm2, color_coverage, display_order) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [
              item.id,
              styleId,
              item.imageUrl,
              item.type,
              item.areaCm2,
              item.colorCoverage,
              item.displayOrder,
            ],
          );
        for (const [id, accountId, status, algorithm, modelParameters] of [
          [historicalModelId, accountA, 'ACTIVE', 'AREA_COLOR_SEPARABLE_V1', parameters],
          [historicalDraftId, accountB, 'DRAFT', 'AREA_COLOR_SEPARABLE_V1', null],
          [idwModelId, accountC, 'SUPERSEDED', 'IDW_CONVEX_HULL_V1', idwParameters],
        ] as const) {
          await client.query(
            'INSERT INTO pricing_model_versions (id, account_id, style_id, version, status, case_snapshot, algorithm_version, model_parameters) VALUES ($1, $2, $3, 1, $4, $5, $6, $7)',
            [
              id,
              accountId,
              styleId,
              status,
              JSON.stringify(legacyCases),
              algorithm,
              modelParameters ? JSON.stringify(modelParameters) : null,
            ],
          );
          for (const [index, item] of legacyCases.entries())
            await client.query(
              'INSERT INTO calibration_answers (id, model_version_id, case_id, price_pen) VALUES ($1, $2, $3, $4)',
              [randomUUID(), id, item.id, prices[index]],
            );
        }
      });
      fineLineId = (
        await database.prisma.tattooStyle.findUniqueOrThrow({
          where: { code: 'FINE_LINE' },
        })
      ).id;
      fineLineRoute = `/api/dashboard/calibration/styles/${fineLineId}`;
      service = new CalibrationService(database.prisma as unknown as PrismaService);
      const fixture = await Test.createTestingModule({
        controllers: [CalibrationController, CatalogController],
        providers: [
          SessionAuthGuard,
          TattooArtistGuard,
          AdminGuard,
          { provide: PrismaService, useValue: database.prisma },
          { provide: CalibrationService, useValue: service },
          CatalogService,
          CatalogImportService,
          {
            provide: AuthService,
            useValue: {
              authenticateSession: (token: string) => ({
                id: token,
                role: token === 'admin' ? UserRole.ADMIN : UserRole.TATTOO_ARTIST,
                accountId: token === 'A' ? accountA : token === 'B' ? accountB : accountC,
              }),
            },
          },
        ],
      }).compile();
      app = fixture.createNestApplication<INestApplication<Server>>();
      app.setGlobalPrefix('api');
      app.useGlobalPipes(
        new ValidationPipe({ forbidNonWhitelisted: true, transform: true, whitelist: true }),
      );
      await app.init();
    }, 120_000);

    afterAll(async () => {
      await app?.close();
      await database?.close();
    }, 30_000);

    it('applies the additive migration without adding account ownership or rewriting old cases/models', async () => {
      const columns = await database.client.query<{ column_name: string }>(
        'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2',
        [database.schema, 'calibration_cases'],
      );
      expect(columns.rows.map((item) => item.column_name)).not.toContain('account_id');
      const oldCase = await database.prisma.calibrationCase.findUniqueOrThrow({
        where: { id: legacyCases[0].id },
      });
      expect(oldCase).toMatchObject({
        type: 'AREA',
        phase: null,
        caseKey: null,
        density: null,
        sizeCm: null,
      });
      const oldModel = await database.prisma.pricingModelVersion.findUniqueOrThrow({
        where: { id: historicalModelId },
      });
      expect(oldModel.caseSnapshot).toEqual(legacyCases);
      expect(oldModel.modelParameters).toEqual(parameters);
      const idw = await database.prisma.pricingModelVersion.findUniqueOrThrow({
        where: { id: idwModelId },
      });
      expect(idw.algorithmVersion).toBe('IDW_CONVEX_HULL_V1');
      expect(idw.caseSnapshot).toEqual(legacyCases);
      expect(idw.modelParameters).toEqual(idwParameters);
      expect(await database.prisma.calibrationAnswer.count()).toBe(18);
      for (const item of historicalColors) {
        expect(
          await database.prisma.conversation.findUniqueOrThrow({
            where: { id: item.conversationId },
          }),
        ).toMatchObject({
          colorDeclaration: item.colorDeclaration,
          targetSizeCm: 11,
        });
        expect(
          await database.prisma.lead.findUniqueOrThrow({ where: { id: item.leadId } }),
        ).toMatchObject({
          colorDeclaration: item.colorDeclaration,
        });
      }
    });

    it('retires only Fine Line live cases and preserves every historical price and snapshot', async () => {
      expect(await database.prisma.calibrationCase.count({ where: { styleId: fineLineId } })).toBe(
        0,
      );
      expect(await database.prisma.calibrationCase.count({ where: { styleId } })).toBe(3);
      const previous = await database.prisma.pricingModelVersion.findUniqueOrThrow({
        where: { id: retiredFineLineModelId },
        include: { answers: true },
      });
      expect(previous.status).toBe('ACTIVE');
      expect(previous.caseSnapshot).toEqual(retiredFineLineCases);
      expect(previous.modelParameters).toEqual(retiredFineLineParameters);
      for (const [index, item] of retiredFineLineCases.entries())
        expect(
          previous.answers.find((answer) => answer.caseId === item.id)!.pricePen.toFixed(2),
        ).toBe(Number(retiredFineLinePrices[index]).toFixed(2));
      expect(
        await database.prisma.pricingModelVersion.findUniqueOrThrow({
          where: { id: retiredFineLineDraftId },
        }),
      ).toMatchObject({ status: 'SUPERSEDED', caseSnapshot: retiredFineLineCases });
      expect(
        await database.prisma.quote.findUniqueOrThrow({ where: { id: retiredFineLineQuoteId } }),
      ).toMatchObject({ amount: new Prisma.Decimal(100), snapshot: retiredFineLineQuoteSnapshot });
      const answer = previous.answers[0];
      await database.prisma.calibrationAnswer.update({
        where: { id: answer.id },
        data: { caseId: answer.caseId },
      });
      await expect(
        database.prisma.calibrationAnswer.update({
          where: { id: answer.id },
          data: { caseId: randomUUID() },
        }),
      ).rejects.toThrow();
      await expect(
        database.prisma.calibrationCase.create({
          data: { styleId: fineLineId, ...retiredFineLineCases[0] },
        }),
      ).rejects.toThrow();
    });

    it('reads and activates an existing AREA/COLOR draft and keeps current pricing', async () => {
      const oldDraft = await api()
        .post(`${route}/draft`)
        .set('Cookie', 'tatto_flow_session=B')
        .expect(201);
      expect(oldDraft.body).toMatchObject({
        id: historicalDraftId,
        catalogFormat: 'AREA_COLOR',
        canActivate: true,
        answeredCount: 3,
      });
      await api().post(`${route}/draft/activate`).set('Cookie', 'tatto_flow_session=B').expect(201);
      expect(await service.calculatePrice(accountA, styleId, 10, 0.25)).toMatchObject({
        applicable: true,
        pricePen: '125.00',
        modelVersionId: historicalModelId,
      });
      expect(await service.calculatePrice(accountB, styleId, 10, 0.25)).toMatchObject({
        applicable: true,
        pricePen: '125.00',
        modelVersionId: historicalDraftId,
      });
    });

    it('rejects invalid manifests and graph relations atomically', async () => {
      const invalid = structuredClone(manifest);
      invalid.cases[0].density.value = 101;
      await api()
        .post('/api/admin/catalog/import')
        .set('Cookie', 'tatto_flow_session=admin')
        .send(invalid)
        .expect(400);
      invalid.cases[0].density.value = 50;
      invalid.cases[0].sizeCm = 11;
      await api()
        .post('/api/admin/catalog/import')
        .set('Cookie', 'tatto_flow_session=admin')
        .send(invalid)
        .expect(409);
      expect(await database.prisma.calibrationCase.count({ where: { phase: { not: null } } })).toBe(
        0,
      );
    });

    it('imports both phases once, resolves parents before B and reimports idempotently', async () => {
      await api()
        .post('/api/admin/catalog/import')
        .set('Cookie', 'tatto_flow_session=A')
        .send(manifest)
        .expect(403);
      const imported = await api()
        .post('/api/admin/catalog/import')
        .set('Cookie', 'tatto_flow_session=admin')
        .send(manifest)
        .expect(201);
      expect(imported.body).toEqual({
        catalogVersion: 'TEST_REV_1',
        caseCount: 3,
        changedCount: 3,
      });
      const second = await api()
        .post('/api/admin/catalog/import')
        .set('Cookie', 'tatto_flow_session=admin')
        .send(manifest)
        .expect(201);
      expect(second.body.changedCount).toBe(0);
      expect(await database.prisma.calibrationCase.count({ where: { phase: { not: null } } })).toBe(
        3,
      );
    });

    it('returns the same active ordered global cases to both accounts', async () => {
      const a = await api()
        .get(`${route}/cases?catalog=PHASED`)
        .set('Cookie', 'tatto_flow_session=A')
        .expect(200);
      const b = await api()
        .get(`${route}/cases?catalog=PHASED`)
        .set('Cookie', 'tatto_flow_session=B')
        .expect(200);
      expect(a.body).toEqual(b.body);
      expect(a.body).toMatchObject([
        { caseKey: 'TEST_B_001', phase: 'B', density: 76.2 },
        { caseKey: 'TEST_A_001', phase: 'A', sizeCm: 10.5 },
      ]);
      expect(a.body).toHaveLength(2);
      await database.prisma.artistStyle.update({
        where: { accountId_styleId: { accountId: accountC, styleId } },
        data: { isEnabled: false },
      });
      await api()
        .get(`${route}/cases?catalog=PHASED`)
        .set('Cookie', 'tatto_flow_session=C')
        .expect(404);
      await database.prisma.artistStyle.update({
        where: { accountId_styleId: { accountId: accountC, styleId } },
        data: { isEnabled: true },
      });
    });

    it('freezes all A/B metadata and isolates drafts and prices between accounts', async () => {
      const a = await api()
        .post(`${route}/draft`)
        .set('Cookie', 'tatto_flow_session=A')
        .send({ catalog: 'PHASED' })
        .expect(201);
      const b = await api()
        .post(`${route}/draft`)
        .set('Cookie', 'tatto_flow_session=B')
        .send({ catalog: 'PHASED' })
        .expect(201);
      expect(a.body.id).not.toBe(b.body.id);
      expect(a.body).toMatchObject({
        catalogFormat: 'PHASED',
        canActivate: false,
        totalCount: 2,
        answeredCount: 0,
      });
      expect(a.body.cases[0]).toMatchObject({
        caseKey: 'TEST_B_001',
        styleId,
        styleCode: 'TEST_STYLE',
        phase: 'B',
        imageKey: 'TEST_B_001.png',
        sizeCm: 10.5,
        colorCoverage: 0.25,
        colorMetadata: manifest.cases[0].color.metadata,
        density: 76.2,
        densityMetadata: manifest.cases[0].density.metadata,
        catalogVersion: 'TEST_REV_1',
        baseCaseKey: 'TEST_A_001',
        displayOrder: 10,
        isActive: true,
      });
      const sharedCaseId: string = a.body.cases[0].id;
      expect(b.body.cases[0].id).toBe(sharedCaseId);
      await api()
        .put(`${route}/draft/answers/${sharedCaseId}`)
        .set('Cookie', 'tatto_flow_session=A')
        .send({ price: 180, accountId: accountB })
        .expect(400);
      await api()
        .put(`${route}/draft/answers/${sharedCaseId}`)
        .set('Cookie', 'tatto_flow_session=A')
        .send({ price: 180 })
        .expect(200);
      const unansweredB = await api()
        .get(`${route}/draft`)
        .set('Cookie', 'tatto_flow_session=B')
        .expect(200);
      expect(unansweredB.body.cases[0].pricePen).toBeNull();
      await api()
        .put(`${route}/draft/answers/${sharedCaseId}`)
        .set('Cookie', 'tatto_flow_session=B')
        .send({ price: 250 })
        .expect(200);
      const aRead = await api()
        .get(`${route}/draft`)
        .set('Cookie', 'tatto_flow_session=A')
        .expect(200);
      const bRead = await api()
        .get(`${route}/draft`)
        .set('Cookie', 'tatto_flow_session=B')
        .expect(200);
      expect(aRead.body.cases[0].pricePen).toBe('180.00');
      expect(bRead.body.cases[0].pricePen).toBe('250.00');
      expect(
        await database.prisma.calibrationAnswer.count({ where: { caseId: sharedCaseId } }),
      ).toBe(2);
      await api()
        .put(`${route}/draft/answers/${legacyCases[0].id}`)
        .set('Cookie', 'tatto_flow_session=A')
        .send({ price: 300 })
        .expect(404);
      await api().post(`${route}/draft`).set('Cookie', 'tatto_flow_session=A').expect(409);
    });

    it('refuses A/B activation and leaves the existing active pricing intact', async () => {
      await api().post(`${route}/draft/activate`).set('Cookie', 'tatto_flow_session=A').expect(409);
      const draft = await database.prisma.pricingModelVersion.findFirstOrThrow({
        where: { accountId: accountA, status: 'DRAFT' },
      });
      expect(draft.algorithmVersion).toBe('CATALOG_AB_PENDING');
      expect(draft.modelParameters).toBeNull();
      expect(await service.calculatePrice(accountA, styleId, 10, 0.25)).toMatchObject({
        applicable: true,
        pricePen: '125.00',
        modelVersionId: historicalModelId,
      });
    });

    it('requires a new revision for changed metadata and preserves previous snapshots and answers', async () => {
      const before = await service.getDraft(accountA, styleId);
      const revision = structuredClone(manifest);
      revision.cases[0].density.value = 94;
      await api()
        .post('/api/admin/catalog/import')
        .set('Cookie', 'tatto_flow_session=admin')
        .send(revision)
        .expect(409);
      revision.catalogVersion = 'TEST_REV_2';
      revision.imageBaseUrl = 'https://catalog.test.invalid/revision-2/';
      revision.cases[1].active = false;
      revision.cases[2].active = true;
      await api()
        .post('/api/admin/catalog/import')
        .set('Cookie', 'tatto_flow_session=admin')
        .send(revision)
        .expect(201);
      expect(await service.getDraft(accountA, styleId)).toEqual(before);
      const current = await api()
        .post(`${route}/draft`)
        .set('Cookie', 'tatto_flow_session=C')
        .send({ catalog: 'PHASED' })
        .expect(201);
      const currentCases = current.body.cases as { caseKey: string }[];
      expect(currentCases.map((item) => item.caseKey)).toEqual(['TEST_A_002', 'TEST_B_001']);
      expect(current.body.cases[1]).toMatchObject({
        id: before!.cases[0].id,
        density: 94,
        catalogVersion: 'TEST_REV_2',
        imageUrl: 'https://catalog.test.invalid/revision-2/TEST_B_001.png',
      });
      const old = await database.prisma.pricingModelVersion.findUniqueOrThrow({
        where: { id: historicalModelId },
      });
      expect(old.caseSnapshot).toEqual(legacyCases);
      expect(old.modelParameters).toEqual(parameters);
      expect(await service.calculatePrice(accountA, styleId, 10, 0.25)).toMatchObject({
        applicable: true,
        pricePen: '125.00',
      });
    });

    it('enforces size/density bounds in PostgreSQL as well as the manifest parser', async () => {
      const item = await database.prisma.calibrationCase.findUniqueOrThrow({
        where: { caseKey: 'TEST_A_002' },
      });
      for (const data of [{ sizeCm: 0 }, { sizeCm: -1 }, { density: -0.1 }, { density: 100.1 }]) {
        await expect(
          database.prisma.calibrationCase.update({ where: { id: item.id }, data }),
        ).rejects.toThrow();
      }
      await database.prisma.calibrationCase.update({
        where: { id: item.id },
        data: { density: 0 },
      });
      await database.prisma.calibrationCase.update({
        where: { id: item.id },
        data: { density: 100 },
      });
    });

    it('imports the real Fine Line files as 20 A and 5 B cases in order, with FL_A_09 as the base', async () => {
      const folder = '../frontend/public/calibration-assets/v1/Fine_Line';
      const fineLine = await readCatalogImport(`${folder}/catalog.json`, folder);
      await database.prisma.artistStyle.createMany({
        data: [accountA, accountB].map((accountId) => ({ accountId, styleId: fineLineId })),
      });
      const imported = await api()
        .post('/api/admin/catalog/import')
        .set('Cookie', 'tatto_flow_session=admin')
        .send(fineLine)
        .expect(201);
      expect(imported.body).toEqual({
        catalogVersion: fineLine.catalogVersion,
        caseCount: 25,
        changedCount: 25,
      });
      const repeated = await api()
        .post('/api/admin/catalog/import')
        .set('Cookie', 'tatto_flow_session=admin')
        .send(fineLine)
        .expect(201);
      expect(repeated.body.changedCount).toBe(0);
      const cases = await service.listCases(accountA, fineLineId, 'PHASED');
      const expectedKeys = [
        ...Array.from({ length: 20 }, (_, index) => `FL_A_${String(index + 1).padStart(2, '0')}`),
        ...Array.from({ length: 5 }, (_, index) => `FL_B_${String(index + 1).padStart(2, '0')}`),
      ];
      expect(cases.map((item) => 'caseKey' in item && item.caseKey)).toEqual(expectedKeys);
      expect(cases).toEqual(await service.listCases(accountB, fineLineId, 'PHASED'));
      for (const [index, item] of fineLine.cases.entries()) {
        expect(cases[index]).toMatchObject({
          caseKey: item.caseId,
          styleId: fineLineId,
          styleCode: 'FINE_LINE',
          phase: item.phase,
          imageUrl: `/calibration-assets/v1/Fine_Line/${item.image}`,
          imageKey: item.image,
          sizeCm: item.sizeCm,
          colorCoverage: item.color.coverage,
          colorMetadata: item.color.metadata,
          density: item.density.value,
          densityMetadata: item.density.metadata,
          baseCaseKey: index < 20 ? null : 'FL_A_09',
          catalogVersion: fineLine.catalogVersion,
          displayOrder: index + 1,
          isActive: true,
        });
      }
      const styles = await service.listStyles(accountA);
      expect(styles.find((item) => item.id === fineLineId)).toMatchObject({
        enabled: true,
        caseCount: 0,
        catalogCaseCount: 25,
      });
    });

    it('completes all 25 Fine Line answers, builds the new model and keeps account prices separate', async () => {
      const a = await api()
        .post(`${fineLineRoute}/draft`)
        .set('Cookie', 'tatto_flow_session=A')
        .send({})
        .expect(201);
      const b = await api()
        .post(`${fineLineRoute}/draft`)
        .set('Cookie', 'tatto_flow_session=B')
        .send({ catalog: 'PHASED' })
        .expect(201);
      expect(a.body).toMatchObject({
        catalogFormat: 'PHASED',
        canActivate: false,
        totalCount: 25,
        answeredCount: 0,
      });
      expect(a.body.id).not.toBe(b.body.id);
      expect(a.body.cases).toEqual(b.body.cases);
      const initial = await database.prisma.pricingModelVersion.findUniqueOrThrow({
        where: { id: a.body.id as string },
      });
      const cases = a.body.cases as { id: string; caseKey: string }[];
      for (const [index, item] of cases.entries()) {
        const saved = await api()
          .put(`${fineLineRoute}/draft/answers/${item.id}`)
          .set('Cookie', 'tatto_flow_session=A')
          .send({ price: 150.25 + index })
          .expect(200);
        expect(saved.body).toMatchObject({
          totalCount: 25,
          answeredCount: index + 1,
          canActivate: index === 24,
        });
        expect(saved.body.cases[index].pricePen).toBe((150.25 + index).toFixed(2));
      }
      const unansweredB = await api()
        .get(`${fineLineRoute}/draft`)
        .set('Cookie', 'tatto_flow_session=B')
        .expect(200);
      expect(unansweredB.body.answeredCount).toBe(0);
      expect(
        (unansweredB.body.cases as { pricePen: string | null }[]).every(
          (item) => item.pricePen === null,
        ),
      ).toBe(true);
      await api()
        .put(`${fineLineRoute}/draft/answers/${cases[0].id}`)
        .set('Cookie', 'tatto_flow_session=B')
        .send({ price: 999.5 })
        .expect(200);
      const resumed = await api()
        .post(`${fineLineRoute}/draft`)
        .set('Cookie', 'tatto_flow_session=A')
        .send({ catalog: 'PHASED' })
        .expect(201);
      expect(resumed.body).toMatchObject({ id: a.body.id, totalCount: 25, answeredCount: 25 });
      expect(resumed.body.cases[0].pricePen).toBe('150.25');
      expect((await service.getDraft(accountB, fineLineId))!.cases[0].pricePen).toBe('999.50');
      const completed = await database.prisma.pricingModelVersion.findUniqueOrThrow({
        where: { id: a.body.id as string },
      });
      expect(completed).toMatchObject({
        status: 'DRAFT',
        algorithmVersion: CATALOG_AB_ALGORITHM_VERSION,
      });
      expect(completed.caseSnapshot).toEqual(initial.caseSnapshot);
      expect(completed.modelParameters).toMatchObject({
        algorithmVersion: CATALOG_AB_ALGORITHM_VERSION,
        styleId: fineLineId,
        anchorDensity: 60,
      });
      expect(completed.caseSnapshot).toEqual(
        await service.listCases(accountA, fineLineId, 'PHASED'),
      );
      expect(
        await database.prisma.calibrationAnswer.count({ where: { modelVersionId: completed.id } }),
      ).toBe(25);
      await api()
        .post(`${fineLineRoute}/draft/activate`)
        .set('Cookie', 'tatto_flow_session=A')
        .expect(201);
      expect(await service.calculatePrice(accountA, fineLineId, 10, 0.25)).toMatchObject({
        applicable: false,
      });
      expect(await service.calculatePrice(accountA, styleId, 10, 0.25)).toMatchObject({
        applicable: true,
        pricePen: '125.00',
        modelVersionId: historicalModelId,
      });
    }, 120_000);

    async function quoteFor(
      accountId: string,
      size = 9,
      density = 70,
      valid = true,
      colorDeclaration: ColorDeclaration = 'MEDIUM_COLOR',
    ) {
      const analysis = {
        ...persistedVision(),
        estimatedDensity: density,
        validTattooReference: valid,
        referenceMainDimensionCm: null,
        referenceAreaCm2: null,
        compositionAspectRatio: null,
        compositionFillRatio: null,
        scaleReferenceType: 'NONE' as const,
        referenceEssentiallyBlack: false,
        colorCoverage: 0.375,
      };
      const customer = await database.prisma.customer.create({
        data: { accountId, phoneNumber: randomUUID().slice(0, 20) },
      });
      const intake = {
        firstTattoo: false,
        sameSizeAsReference: true,
        targetSizeCm: size,
        colorDeclaration,
        bodyPart: 'Brazo',
      };
      const preparation = prepareV2Case(intake, analysis, {
        exists: true,
        enabled: true,
        pricingAlgorithmVersion: CATALOG_AB_ALGORITHM_VERSION,
      });
      const lead = await database.prisma.lead.create({
        data: {
          accountId,
          customerId: customer.id,
          ...intake,
          v2Preparation: {
            ...preparation,
            decision: 'READY_FOR_PRICING',
          },
        },
      });
      await database.prisma.aiAnalysis.create({
        data: {
          ...analysis,
          id: undefined,
          leadId: lead.id,
          rawResponse: analysis.rawResponse as Prisma.InputJsonValue,
        },
      });
      const result = await database.prisma.$transaction((tx) =>
        new QuoteV2Service().getOrCreate(tx, accountId, lead.id),
      );
      return { lead, result };
    }

    it('activates calibrated models per account, supersedes only Fine Line and preserves old quote snapshots', async () => {
      const oldQuote = await quoteFor(accountA);
      expect(oldQuote.result.applicable).toBe(true);
      const oldModel = await database.prisma.pricingModelVersion.findFirstOrThrow({
        where: { accountId: accountA, styleId: fineLineId, status: 'ACTIVE' },
      });
      for (const [index, accountId] of [accountA, accountB].entries()) {
        const draft = (await service.startDraft(accountId, fineLineId, 'PHASED'))!;
        const prices = catalogABPricingFixture(fineLineId, index + 1);
        await database.prisma.calibrationAnswer.deleteMany({ where: { modelVersionId: draft.id } });
        await database.prisma.calibrationAnswer.createMany({
          data: draft.cases.map((item, position) => ({
            modelVersionId: draft.id,
            caseId: item.id,
            pricePen: prices[position].pricePen,
          })),
        });
        if (accountId === accountB) {
          const resumed = await service.startDraft(accountId, fineLineId, 'PHASED');
          expect(resumed?.canActivate).toBe(true);
          const materialized = await database.prisma.pricingModelVersion.findUniqueOrThrow({
            where: { id: draft.id },
          });
          expect(materialized.algorithmVersion).toBe(CATALOG_AB_ALGORITHM_VERSION);
          expect(materialized.modelParameters).not.toBeNull();
        }
        const last = draft.cases[24];
        const ready = (await service.saveAnswer(
          accountId,
          fineLineId,
          last.id,
          Number(prices[24].pricePen),
        ))!;
        expect(ready).toMatchObject({
          answeredCount: 25,
          canActivate: true,
          calibrationError: null,
        });
        const model = await database.prisma.pricingModelVersion.findUniqueOrThrow({
          where: { id: draft.id },
        });
        expect(model.algorithmVersion).toBe(CATALOG_AB_ALGORITHM_VERSION);
        expect(model.modelParameters).toMatchObject({
          styleId: fineLineId,
          sizeKnots: [4, 7, 11, 18, 30],
          colorKnots: [0, 0.25, 0.5, 1],
        });
        await api()
          .post(`${fineLineRoute}/draft/activate`)
          .set('Cookie', `tatto_flow_session=${index === 0 ? 'A' : 'B'}`)
          .expect(201);
      }
      const superseded = await database.prisma.pricingModelVersion.findUniqueOrThrow({
        where: { id: oldModel.id },
      });
      expect(superseded.status).toBe('SUPERSEDED');
      expect(superseded.modelParameters).toEqual(oldModel.modelParameters);
      expect(superseded.caseSnapshot).toEqual(oldModel.caseSnapshot);
      expect(await service.calculatePrice(accountA, styleId, 10, 0.25)).toMatchObject({
        pricePen: '125.00',
        modelVersionId: historicalModelId,
      });
      const again = await database.prisma.$transaction((tx) =>
        new QuoteV2Service().getOrCreate(tx, accountA, oldQuote.lead.id),
      );
      expect(again).toEqual(oldQuote.result);
      for (const [declaration, coverage, amount] of [
        ['BLACK_ONLY', 0, '220.00'],
        ['LOW_COLOR', 0.25, '290.00'],
        ['MEDIUM_COLOR', 0.5, '360.00'],
        ['FULL_COLOR', 1, '480.00'],
      ] as const) {
        const chosen = await quoteFor(accountA, 11, 60, true, declaration);
        expect(chosen.lead).toMatchObject({
          colorDeclaration: declaration,
          v2Preparation: { targetColorCoverage: coverage },
        });
        expect(chosen.result.applicable).toBe(true);
        if (!chosen.result.applicable) return;
        expect(chosen.result.quote.amount.toFixed(2)).toBe(amount);
        expect(chosen.result.quote.targetColorCoverage.toNumber()).toBe(coverage);
        expect(chosen.result.quote.snapshot).toMatchObject({
          colorDeclaration: declaration,
          targetColorSource: 'CLIENT_DECLARATION',
        });
      }
      const a = await quoteFor(accountA),
        b = await quoteFor(accountB);
      expect(a.result.applicable && a.result.quote.amount.toFixed(2)).toBe('350.75');
      expect(b.result.applicable && b.result.quote.amount.toFixed(2)).toBe('701.50');
      if (!a.result.applicable || !b.result.applicable) return;
      expect(a.result.quote.targetAreaCm2).toBeNull();
      expect(a.result.quote.snapshot).toMatchObject({
        version: 2,
        targetSizeCm: 9,
        estimatedDensity: 70,
        validTattooReference: true,
        calculation: { basePricePen: '305', densityFactor: '1.15' },
      });
      const preserved = structuredClone(a.result.quote.snapshot);
      await service.setAdjustment(accountA, 10);
      const adjusted = await quoteFor(accountA);
      expect(adjusted.result.applicable && adjusted.result.quote.amount.toFixed(2)).toBe('385.83');
      expect(
        (await database.prisma.quote.findUniqueOrThrow({ where: { id: a.result.quote.id } }))
          .snapshot,
      ).toEqual(preserved);
      expect(
        await database.prisma.$transaction((tx) =>
          new QuoteV2Service().getOrCreate(tx, accountA, a.lead.id),
        ),
      ).toEqual(a.result);
      await expect(
        database.prisma.$transaction((tx) =>
          new QuoteV2Service().getOrCreate(tx, accountB, a.lead.id),
        ),
      ).rejects.toThrow(/Lead no disponible/);
      const active = await database.prisma.pricingModelVersion.findFirstOrThrow({
        where: { accountId: accountA, styleId: fineLineId, status: 'ACTIVE' },
      });
      expect(active.algorithmVersion).toBe(CATALOG_AB_ALGORITHM_VERSION);
      expect(active.adjustmentPercent.toFixed(2)).toBe('10.00');
      expect(
        await service.calculatePrice(accountB, fineLineId, {
          targetSizeCm: 9,
          colorCoverage: 0.5,
          estimatedDensity: 70,
        }),
      ).toMatchObject({ pricePen: '701.50' });
    }, 120_000);

    it('recalibrates Fine Line from zero with the same 25 references and supersedes only its account and style', async () => {
      const previous = await database.prisma.pricingModelVersion.findFirstOrThrow({
        where: { accountId: accountA, styleId: fineLineId, status: 'ACTIVE' },
      });
      const untouched = await database.prisma.pricingModelVersion.findMany({
        where: { status: 'ACTIVE', NOT: { accountId: accountA, styleId: fineLineId } },
        orderBy: { id: 'asc' },
      });
      const historicalQuotes = await database.prisma.quote.findMany({ orderBy: { id: 'asc' } });
      const partial = (await service.startDraft(accountA, fineLineId))!;
      await service.saveAnswer(accountA, fineLineId, partial.cases[0].id, 333);
      expect(await service.startDraft(accountA, fineLineId)).toMatchObject({
        id: partial.id,
        answeredCount: 1,
      });
      const response = await api()
        .post(`${fineLineRoute}/draft`)
        .set('Cookie', 'tatto_flow_session=A')
        .send({ catalog: 'AREA_COLOR', restart: true })
        .expect(201);
      expect(response.body).toMatchObject({
        catalogFormat: 'PHASED',
        totalCount: 25,
        answeredCount: 0,
        canActivate: false,
      });
      expect(response.body.id).not.toBe(partial.id);
      expect(
        (response.body.cases as { pricePen: string | null }[]).every(
          (item) => item.pricePen === null,
        ),
      ).toBe(true);
      const draft = await database.prisma.pricingModelVersion.findUniqueOrThrow({
        where: { id: response.body.id as string },
      });
      expect(draft.caseSnapshot).toEqual(previous.caseSnapshot);
      expect(draft.algorithmVersion).toBe('CATALOG_AB_PENDING');
      expect(draft.modelParameters).toBeNull();
      expect(
        await database.prisma.pricingModelVersion.findUniqueOrThrow({ where: { id: partial.id } }),
      ).toMatchObject({ status: 'SUPERSEDED' });
      expect(
        await database.prisma.calibrationAnswer.findUniqueOrThrow({
          where: {
            modelVersionId_caseId: { modelVersionId: partial.id, caseId: partial.cases[0].id },
          },
        }),
      ).toMatchObject({ pricePen: new Prisma.Decimal(333) });
      await api()
        .post(`${fineLineRoute}/draft/activate`)
        .set('Cookie', 'tatto_flow_session=A')
        .expect(409);
      const prices = catalogABPricingFixture(fineLineId, 3);
      await database.prisma.calibrationAnswer.createMany({
        data: partial.cases.map((item, index) => ({
          modelVersionId: draft.id,
          caseId: item.id,
          pricePen: prices[index].pricePen,
        })),
      });
      const ready = await api()
        .put(`${fineLineRoute}/draft/answers/${partial.cases[24].id}`)
        .set('Cookie', 'tatto_flow_session=A')
        .send({ price: Number(prices[24].pricePen) })
        .expect(200);
      expect(ready.body).toMatchObject({ totalCount: 25, answeredCount: 25, canActivate: true });
      const activated = await api()
        .post(`${fineLineRoute}/draft/activate`)
        .set('Cookie', 'tatto_flow_session=A')
        .expect(201);
      expect(activated.body).toMatchObject({
        id: draft.id,
        status: 'ACTIVE',
        algorithmVersion: CATALOG_AB_ALGORITHM_VERSION,
        sourceVersionId: previous.id,
      });
      expect(activated.body.version).toBeGreaterThan(previous.version);
      expect(
        await database.prisma.pricingModelVersion.findUniqueOrThrow({ where: { id: previous.id } }),
      ).toMatchObject({
        status: 'SUPERSEDED',
        caseSnapshot: previous.caseSnapshot,
        modelParameters: previous.modelParameters,
      });
      expect(
        await database.prisma.pricingModelVersion.findMany({
          where: { id: { in: untouched.map((item) => item.id) } },
          orderBy: { id: 'asc' },
        }),
      ).toEqual(untouched);
      expect(await database.prisma.quote.findMany({ orderBy: { id: 'asc' } })).toEqual(
        historicalQuotes,
      );
    }, 120_000);

    it('refuses uncalibrated inputs and invalid references without creating a quote', async () => {
      for (const [size, density, valid] of [
        [3.99, 70, true],
        [30.01, 70, true],
        [9, 19.99, true],
        [9, 0, false],
      ] as const) {
        const { lead, result } = await quoteFor(accountA, size, density, valid);
        expect(result).toEqual({ applicable: false, reason: 'MODEL_NOT_APPLICABLE' });
        expect(await database.prisma.quote.findUnique({ where: { leadId: lead.id } })).toBeNull();
      }
    }, 60_000);
  },
);

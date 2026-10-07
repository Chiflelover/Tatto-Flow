import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { Prisma, UserRole } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { TattooArtistGuard } from '../src/modules/auth/role.guard.js';
import { SessionAuthGuard } from '../src/modules/auth/session-auth.guard.js';
import { CalibrationController } from '../src/modules/calibration/calibration.controller.js';
import { CalibrationService } from '../src/modules/calibration/calibration.service.js';
import { CatalogImportService } from '../src/modules/calibration/catalog-import.service.js';
import { readCatalogImport } from '../src/modules/calibration/catalog-import-files.js';
import { catalogABPricingFixture } from './fixtures/catalog-ab-pricing.js';
import { isolatedDatabase } from './helpers/isolated-database.js';

type Draft = NonNullable<Awaited<ReturnType<CalibrationService['getDraft']>>>;

describe.runIf(process.env.RUN_CALIBRATION_DB_TESTS === '1')(
  'idempotent calibration drafts (PostgreSQL E2E)',
  { timeout: 60_000 },
  () => {
    let database: Awaited<ReturnType<typeof isolatedDatabase>>;
    let app: INestApplication<Server>;
    let styleId: string;
    let accountA: string;
    let accountB: string;
    const api = () => request(app.getHttpServer());
    const route = () => `/api/dashboard/calibration/styles/${styleId}/draft`;

    beforeAll(async () => {
      // Two connections let the HTTP requests compete for the real PostgreSQL row lock.
      database = await isolatedDatabase(undefined, { maxConnections: 2 });
      styleId = (
        await database.prisma.tattooStyle.findUniqueOrThrow({
          where: { code: 'FINE_LINE' },
        })
      ).id;
      const folder = '../frontend/public/calibration-assets/v1/Fine_Line';
      await new CatalogImportService(database.prisma).import(
        await readCatalogImport(`${folder}/catalog.json`, folder),
      );
      const fixture = await Test.createTestingModule({
        controllers: [CalibrationController],
        providers: [
          CalibrationService,
          SessionAuthGuard,
          TattooArtistGuard,
          { provide: PrismaService, useValue: database.prisma },
          {
            provide: AuthService,
            useValue: {
              authenticateSession: (token: string) => ({
                id: token,
                role: UserRole.TATTOO_ARTIST,
                accountId: token === 'A' ? accountA : accountB,
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

    beforeEach(async () => {
      accountA = randomUUID();
      accountB = randomUUID();
      await database.prisma.tattooArtistAccount.createMany({
        data: [accountA, accountB].map((id) => ({ id, name: 'Draft test account' })),
      });
      await database.prisma.artistStyle.createMany({
        data: [accountA, accountB].map((accountId) => ({ accountId, styleId, isEnabled: true })),
      });
    });

    afterAll(async () => {
      await app?.close();
      await database?.close();
    }, 30_000);

    async function start(token = 'A') {
      const response = await api()
        .post(route())
        .set('Cookie', `tatto_flow_session=${token}`)
        .send({ catalog: 'PHASED', restart: true })
        .expect(201);
      return response.body as Draft;
    }

    it('creates one 25-case draft, reopens it and reloads it with GET without another version', async () => {
      const first = await start();
      expect(first).toMatchObject({
        version: 1,
        answeredCount: 0,
        totalCount: 25,
        catalogFormat: 'PHASED',
      });
      expect(await start()).toEqual(first);
      for (let reload = 0; reload < 2; reload++)
        await api().get(route()).set('Cookie', 'tatto_flow_session=A').expect(200, first);
      expect(
        await database.prisma.pricingModelVersion.count({
          where: { accountId: accountA, styleId },
        }),
      ).toBe(1);
    });

    it('returns the same draft for concurrent requests using two database connections', async () => {
      const [first, second] = await Promise.all([start(), start()]);
      expect(second).toEqual(first);
      expect(first.version).toBe(1);
      expect(
        await database.prisma.pricingModelVersion.count({
          where: { accountId: accountA, styleId },
        }),
      ).toBe(1);
    });

    it('preserves partial answers on recalibration and reload and isolates another account', async () => {
      const first = await start();
      await api()
        .put(`${route()}/answers/${first.cases[0].id}`)
        .set('Cookie', 'tatto_flow_session=A')
        .send({ price: 333.25 })
        .expect(200);
      const resumed = await start();
      expect(resumed).toMatchObject({ id: first.id, version: 1, answeredCount: 1 });
      expect(resumed.cases[0].pricePen).toBe('333.25');
      await api().get(route()).set('Cookie', 'tatto_flow_session=A').expect(200, resumed);
      const anotherAccount = await start('B');
      expect(anotherAccount.id).not.toBe(first.id);
      expect(anotherAccount).toMatchObject({ version: 1, answeredCount: 0, totalCount: 25 });
      expect(anotherAccount.cases.every((item) => item.pricePen === null)).toBe(true);
      expect(await start()).toEqual(resumed);
    });

    it('enforces the existing unique open-draft index even for a direct insert', async () => {
      const draft = await start();
      const model = await database.prisma.pricingModelVersion.findUniqueOrThrow({
        where: { id: draft.id },
      });
      await expect(
        database.prisma.pricingModelVersion.create({
          data: {
            accountId: accountA,
            styleId,
            version: 2,
            caseSnapshot: model.caseSnapshot as Prisma.InputJsonValue,
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
      expect(await start()).toEqual(draft);
    });

    it('creates exactly one next version after activation even with concurrent recalibration', async () => {
      const first = await start();
      const prices = catalogABPricingFixture(styleId);
      await database.prisma.calibrationAnswer.createMany({
        data: first.cases.map((item, index) => ({
          modelVersionId: first.id,
          caseId: item.id,
          pricePen: prices[index].pricePen,
        })),
      });
      await api().post(`${route()}/activate`).set('Cookie', 'tatto_flow_session=A').expect(201);
      const activated = await database.prisma.pricingModelVersion.findUniqueOrThrow({
        where: { id: first.id },
      });
      expect(activated).toMatchObject({ status: 'ACTIVE', version: 1 });
      const [next, repeated] = await Promise.all([start(), start()]);
      expect(repeated).toEqual(next);
      expect(next).toMatchObject({ version: 2, answeredCount: 0, totalCount: 25 });
      expect(next.id).not.toBe(first.id);
      expect(
        await database.prisma.pricingModelVersion.count({
          where: { accountId: accountA, styleId },
        }),
      ).toBe(2);
      expect(
        await database.prisma.pricingModelVersion.findUniqueOrThrow({ where: { id: first.id } }),
      ).toEqual(activated);
      expect(
        await database.prisma.calibrationAnswer.count({ where: { modelVersionId: first.id } }),
      ).toBe(25);
      expect(await start()).toEqual(next);
    });
  },
);

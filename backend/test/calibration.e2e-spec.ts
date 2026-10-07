import 'reflect-metadata';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { UserRole } from '../src/generated/prisma/client.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { AdminGuard, TattooArtistGuard } from '../src/modules/auth/role.guard.js';
import { SessionAuthGuard } from '../src/modules/auth/session-auth.guard.js';
import { CalibrationController } from '../src/modules/calibration/calibration.controller.js';
import { CalibrationService } from '../src/modules/calibration/calibration.service.js';
import { CatalogController } from '../src/modules/calibration/catalog.controller.js';
import { CatalogService } from '../src/modules/calibration/catalog.service.js';
import { CatalogImportService } from '../src/modules/calibration/catalog-import.service.js';

const styleId = '00000000-0000-4000-8000-000000000010';
const caseId = '00000000-0000-4000-8000-000000000011';
const accountA = '00000000-0000-4000-8000-000000000001';
const accountB = '00000000-0000-4000-8000-000000000002';

describe('calibration routes (e2e)', () => {
  let app: INestApplication<Server>;
  const getDraft = vi.fn().mockResolvedValue(null);
  const saveAnswer = vi.fn().mockResolvedValue(null);
  const createStyle = vi.fn().mockResolvedValue({ id: styleId, code: 'NEW_STYLE' });
  const listCases = vi.fn().mockResolvedValue([]);
  const startDraft = vi.fn().mockResolvedValue({ id: 'draft' });
  const importCatalog = vi.fn().mockResolvedValue({ changedCount: 0 });
  const authenticateSession = vi.fn().mockImplementation((token: string) => {
    if (token === 'admin') return { id: 'admin', role: UserRole.ADMIN, accountId: null };
    if (token === 'A' || token === 'B')
      return {
        id: token,
        role: UserRole.TATTOO_ARTIST,
        accountId: token === 'A' ? accountA : accountB,
      };
    throw new Error('invalid');
  });

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({
      controllers: [CalibrationController, CatalogController],
      providers: [
        SessionAuthGuard,
        TattooArtistGuard,
        AdminGuard,
        { provide: AuthService, useValue: { authenticateSession } },
        { provide: CalibrationService, useValue: { getDraft, saveAnswer, listCases, startDraft } },
        { provide: CatalogService, useValue: { createStyle } },
        { provide: CatalogImportService, useValue: { import: importCatalog } },
      ],
    }).compile();
    app = fixture.createNestApplication<INestApplication<Server>>();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ forbidNonWhitelisted: true, transform: true, whitelist: true }),
    );
    await app.init();
  });

  beforeEach(() => vi.clearAllMocks());
  afterAll(async () => {
    await app.close();
  });

  it('scopes reads and answers to the session account, never to a request body account', async () => {
    await request(app.getHttpServer())
      .get(`/api/dashboard/calibration/styles/${styleId}/draft`)
      .set('Cookie', 'tatto_flow_session=A')
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/dashboard/calibration/styles/${styleId}/draft`)
      .set('Cookie', 'tatto_flow_session=B')
      .expect(200);
    expect(getDraft).toHaveBeenNthCalledWith(1, accountA, styleId);
    expect(getDraft).toHaveBeenNthCalledWith(2, accountB, styleId);
    await request(app.getHttpServer())
      .put(`/api/dashboard/calibration/styles/${styleId}/draft/answers/${caseId}`)
      .set('Cookie', 'tatto_flow_session=A')
      .send({ price: 347, accountId: accountB })
      .expect(400);
    expect(saveAnswer).not.toHaveBeenCalled();
  });

  it('rejects zero and negative calibration prices', async () => {
    for (const price of [0, -10]) {
      await request(app.getHttpServer())
        .put(`/api/dashboard/calibration/styles/${styleId}/draft/answers/${caseId}`)
        .set('Cookie', 'tatto_flow_session=A')
        .send({ price })
        .expect(400);
    }
    await request(app.getHttpServer())
      .put(`/api/dashboard/calibration/styles/${styleId}/draft/answers/${caseId}`)
      .set('Cookie', 'tatto_flow_session=A')
      .send({ price: 347 })
      .expect(200);
    expect(saveAnswer).toHaveBeenCalledWith(accountA, styleId, caseId, 347);
  });

  it('allows only ADMIN to create a new catalog style', async () => {
    await request(app.getHttpServer())
      .post('/api/admin/catalog/styles')
      .set('Cookie', 'tatto_flow_session=A')
      .send({ code: 'NEW_STYLE', name: 'New Style' })
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/admin/catalog/styles')
      .set('Cookie', 'tatto_flow_session=admin')
      .send({ code: 'NEW_STYLE', name: 'New Style' })
      .expect(201);
    expect(createStyle).toHaveBeenCalledOnce();
  });

  it('requires a session for the artist catalog', async () => {
    await request(app.getHttpServer())
      .get(`/api/dashboard/calibration/styles/${styleId}/draft`)
      .expect(401);
  });

  it('accepts old restart requests without forwarding a draft replacement instruction', async () => {
    const route = `/api/dashboard/calibration/styles/${styleId}/draft`;
    await request(app.getHttpServer())
      .post(route)
      .set('Cookie', 'tatto_flow_session=A')
      .send({ catalog: 'PHASED', restart: true })
      .expect(201);
    expect(startDraft).toHaveBeenLastCalledWith(accountA, styleId, 'PHASED');
    for (const restart of ['true', 1])
      await request(app.getHttpServer())
        .post(route)
        .set('Cookie', 'tatto_flow_session=A')
        .send({ catalog: 'PHASED', restart })
        .expect(400);
  });

  it('selects A/B explicitly and keeps the existing default draft route', async () => {
    await request(app.getHttpServer())
      .post(`/api/dashboard/calibration/styles/${styleId}/draft`)
      .set('Cookie', 'tatto_flow_session=A')
      .expect(201);
    expect(startDraft).toHaveBeenLastCalledWith(accountA, styleId, 'AREA_COLOR');
    await request(app.getHttpServer())
      .post(`/api/dashboard/calibration/styles/${styleId}/draft`)
      .set('Cookie', 'tatto_flow_session=A')
      .send({ catalog: 'PHASED' })
      .expect(201);
    expect(startDraft).toHaveBeenLastCalledWith(accountA, styleId, 'PHASED');
    await request(app.getHttpServer())
      .get(`/api/dashboard/calibration/styles/${styleId}/cases?catalog=PHASED`)
      .set('Cookie', 'tatto_flow_session=B')
      .expect(200);
    expect(listCases).toHaveBeenCalledWith(accountB, styleId, 'PHASED');
    await request(app.getHttpServer())
      .post(`/api/dashboard/calibration/styles/${styleId}/draft`)
      .set('Cookie', 'tatto_flow_session=A')
      .send({ catalog: 'UNKNOWN' })
      .expect(400);
  });

  it('allows only ADMIN to import the global catalog', async () => {
    await request(app.getHttpServer())
      .post('/api/admin/catalog/import')
      .set('Cookie', 'tatto_flow_session=A')
      .send({ cases: [] })
      .expect(403);
    expect(importCatalog).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .post('/api/admin/catalog/import')
      .set('Cookie', 'tatto_flow_session=admin')
      .send({ cases: [] })
      .expect(201);
    expect(importCatalog).toHaveBeenCalledWith({ cases: [] });
  });
});

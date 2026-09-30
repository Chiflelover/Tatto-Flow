import 'reflect-metadata';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { UserRole } from '../src/generated/prisma/client.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { AdminGuard, TattooArtistGuard } from '../src/modules/auth/role.guard.js';
import { SessionAuthGuard } from '../src/modules/auth/session-auth.guard.js';
import {
  AdminImagesController,
  ArtistImagesController,
} from '../src/modules/image-management/image-management.controller.js';
import { ImageManagementService } from '../src/modules/image-management/image-management.service.js';

const imageA = '00000000-0000-4000-8000-000000000101';
const imageB = '00000000-0000-4000-8000-000000000102';
const accountA = '00000000-0000-4000-8000-000000000001';

describe('image management routes (e2e)', () => {
  let app: INestApplication<Server>;
  const listAll = vi.fn().mockResolvedValue({ images: [], total: 0, page: 1, totalPages: 1 });
  const deleteMany = vi.fn().mockResolvedValue({ deletedCount: 2, results: [] });
  const artistDownload = vi.fn().mockResolvedValue({
    url: 'https://temporary.example/download',
    fileName: 'reference.jpg',
    expiresInSeconds: 300,
  });
  const authenticateSession = vi.fn().mockImplementation((token: string) => {
    if (token === 'admin') return { id: 'admin-user', role: UserRole.ADMIN, accountId: null };
    if (token === 'artist')
      return { id: 'artist-user', role: UserRole.TATTOO_ARTIST, accountId: accountA };
    throw new Error('invalid');
  });

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({
      controllers: [AdminImagesController, ArtistImagesController],
      providers: [
        SessionAuthGuard,
        TattooArtistGuard,
        AdminGuard,
        { provide: AuthService, useValue: { authenticateSession } },
        { provide: ImageManagementService, useValue: { listAll, deleteMany, artistDownload } },
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

  it('lets ADMIN list all images and delete one or several selected images', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/images')
      .set('Cookie', 'tatto_flow_session=admin')
      .expect(200);
    expect(listAll).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 50 }));
    await request(app.getHttpServer())
      .post('/api/admin/images/delete')
      .set('Cookie', 'tatto_flow_session=admin')
      .send({ ids: [imageA] })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/admin/images/delete')
      .set('Cookie', 'tatto_flow_session=admin')
      .send({ ids: [imageA, imageB] })
      .expect(201);
    expect(deleteMany).toHaveBeenNthCalledWith(1, [imageA], 'admin-user');
    expect(deleteMany).toHaveBeenNthCalledWith(2, [imageA, imageB], 'admin-user');
  });

  it('prevents artists from listing or deleting all images', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/images')
      .set('Cookie', 'tatto_flow_session=artist')
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/admin/images/delete')
      .set('Cookie', 'tatto_flow_session=artist')
      .send({ ids: [imageA] })
      .expect(403);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('passes the artist account to the protected download service', async () => {
    await request(app.getHttpServer())
      .get(`/api/dashboard/images/${imageA}/download`)
      .set('Cookie', 'tatto_flow_session=artist')
      .expect(200);
    expect(artistDownload).toHaveBeenCalledWith(accountA, imageA);
    await request(app.getHttpServer())
      .get(`/api/dashboard/images/${imageA}/download`)
      .set('Cookie', 'tatto_flow_session=admin')
      .expect(403);
  });
});

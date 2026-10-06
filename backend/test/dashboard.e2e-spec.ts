import 'reflect-metadata';
import { type INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { SESSION_COOKIE_NAME } from '../src/modules/auth/auth.constants.js';
import { AuthController } from '../src/modules/auth/auth.controller.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { SessionAuthGuard } from '../src/modules/auth/session-auth.guard.js';
import { TattooArtistGuard } from '../src/modules/auth/role.guard.js';
import { UserRole } from '../src/generated/prisma/client.js';
import { DashboardController } from '../src/modules/dashboard/dashboard.controller.js';
import { DashboardService } from '../src/modules/dashboard/dashboard.service.js';
import { AdminController } from '../src/modules/admin/admin.controller.js';
import { AdminService } from '../src/modules/admin/admin.service.js';
import { AdminGuard } from '../src/modules/auth/role.guard.js';

describe('Dashboard private routes (e2e)', () => {
  let app: INestApplication<Server>;
  const login = vi.fn<AuthService['login']>();
  const authenticateSession = vi.fn<AuthService['authenticateSession']>();
  const logout = vi.fn<AuthService['logout']>();
  const sessionCookieOptions = vi.fn<AuthService['sessionCookieOptions']>();
  const getMetrics = vi.fn<DashboardService['getMetrics']>();
  const createAccount = vi.fn<AdminService['createAccount']>();
  const updateAccount = vi.fn<AdminService['updateAccount']>();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AuthController, DashboardController, AdminController],
      providers: [
        SessionAuthGuard,
        TattooArtistGuard,
        AdminGuard,
        { provide: AdminService, useValue: { createAccount, updateAccount } },
        {
          provide: AuthService,
          useValue: { authenticateSession, login, logout, sessionCookieOptions },
        },
        {
          provide: DashboardService,
          useValue: { getMetrics },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication<INestApplication<Server>>();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        forbidNonWhitelisted: true,
        transform: true,
        whitelist: true,
      }),
    );
    await app.init();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    getMetrics.mockResolvedValue({
      totals: { newOrders: 0, verified: 0, requiresReview: 0, completed: 0 },
      recentLeads: [],
    });
  });

  it('logs in with correct credentials without exposing passwordHash', async () => {
    authenticateSession.mockResolvedValue({
      id: 'bb8bf7d2-e17c-44da-b456-b7240d30daf2',
      email: 'tatuador@example.com',
      role: UserRole.TATTOO_ARTIST,
      accountId: '00000000-0000-4000-8000-000000000001',
    });
    const expiresAt = new Date('2026-09-15T12:00:00.000Z');
    login.mockResolvedValue({
      sessionToken: 'valid-session-token',
      expiresAt,
      user: {
        id: 'bb8bf7d2-e17c-44da-b456-b7240d30daf2',
        email: 'tatuador@example.com',
        role: UserRole.TATTOO_ARTIST,
        accountId: '00000000-0000-4000-8000-000000000001',
      },
    });
    sessionCookieOptions.mockReturnValue({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });

    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'TATUADOR@example.com', password: 'correcta9' })
      .expect(200);

    expect(login).toHaveBeenCalledWith('tatuador@example.com', 'correcta9');
    expect(response.body).toEqual({
      user: {
        id: 'bb8bf7d2-e17c-44da-b456-b7240d30daf2',
        email: 'tatuador@example.com',
        role: UserRole.TATTOO_ARTIST,
        accountId: '00000000-0000-4000-8000-000000000001',
      },
    });
    expect(response.body).not.toHaveProperty('passwordHash');
    expect(response.headers['set-cookie']?.[0]).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(response.headers['set-cookie']?.[0]).toContain('HttpOnly');
  });

  it('rejects incorrect credentials without creating a session cookie', async () => {
    login.mockRejectedValue(new UnauthorizedException('Correo o contraseña incorrectos.'));

    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'tatuador@example.com', password: 'incorrecta9' })
      .expect(401);

    expect(login).toHaveBeenCalledWith('tatuador@example.com', 'incorrecta9');
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('rejects dashboard access without a session', async () => {
    await request(app.getHttpServer()).get('/api/dashboard/metrics').expect(401);

    expect(getMetrics).not.toHaveBeenCalled();
  });

  it('has no routes for retired categorical pricing rules', async () => {
    await request(app.getHttpServer()).get('/api/dashboard/pricing').expect(404);
    await request(app.getHttpServer()).patch('/api/dashboard/pricing').send({}).expect(404);
  });

  it('allows ADMIN account creation and editing, and bars ADMIN from the artist dashboard', async () => {
    authenticateSession.mockResolvedValue({
      id: 'bb8bf7d2-e17c-44da-b456-b7240d30daf2',
      email: 'admin@example.com',
      role: UserRole.ADMIN,
      accountId: null,
    });
    createAccount.mockResolvedValue({ id: '00000000-0000-4000-8000-000000000002' } as never);
    updateAccount.mockResolvedValue({ id: '00000000-0000-4000-8000-000000000002' } as never);
    const cookie = `${SESSION_COOKIE_NAME}=valid-session-token`;
    const id = '00000000-0000-4000-8000-000000000002';

    await request(app.getHttpServer())
      .post('/api/admin/accounts')
      .set('Cookie', cookie)
      .send({
        name: 'Tatuador A',
        email: 'artist-a@example.com',
        password: 'Una-clave-segura-123',
        phoneNumber: '+51 999 888 777',
        phoneNumberId: '12345',
        isActive: true,
      })
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/admin/accounts/${id}`)
      .set('Cookie', cookie)
      .send({ name: 'Tatuador A actualizado' })
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/dashboard/metrics')
      .set('Cookie', cookie)
      .expect(403);
    expect(createAccount).toHaveBeenCalledOnce();
    expect(updateAccount).toHaveBeenCalledWith(id, { name: 'Tatuador A actualizado' });
    expect(getMetrics).not.toHaveBeenCalled();
  });

  it('bars TATTOO_ARTIST from creating or editing accounts', async () => {
    authenticateSession.mockResolvedValue({
      id: 'bb8bf7d2-e17c-44da-b456-b7240d30daf2',
      email: 'artist@example.com',
      role: UserRole.TATTOO_ARTIST,
      accountId: '00000000-0000-4000-8000-000000000001',
    });
    const cookie = `${SESSION_COOKIE_NAME}=valid-session-token`;
    await request(app.getHttpServer())
      .post('/api/admin/accounts')
      .set('Cookie', cookie)
      .send({})
      .expect(403);
    await request(app.getHttpServer())
      .patch('/api/admin/accounts/00000000-0000-4000-8000-000000000002')
      .set('Cookie', cookie)
      .send({ name: 'Intruso' })
      .expect(403);
    expect(createAccount).not.toHaveBeenCalled();
    expect(updateAccount).not.toHaveBeenCalled();
  });

  it('allows dashboard access with a valid session', async () => {
    authenticateSession.mockResolvedValue({
      id: 'bb8bf7d2-e17c-44da-b456-b7240d30daf2',
      email: 'tatuador@example.com',
      role: UserRole.TATTOO_ARTIST,
      accountId: '00000000-0000-4000-8000-000000000001',
    });

    await request(app.getHttpServer())
      .get('/api/dashboard/metrics')
      .set('Cookie', `${SESSION_COOKIE_NAME}=valid-session-token`)
      .expect(200);

    expect(authenticateSession).toHaveBeenCalledWith('valid-session-token');
    expect(getMetrics).toHaveBeenCalledOnce();
  });

  afterAll(async () => {
    await app.close();
  });
});

import 'reflect-metadata';
import {
  type INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { SESSION_COOKIE_NAME } from '../src/modules/auth/auth.constants.js';
import { AuthController } from '../src/modules/auth/auth.controller.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { SessionAuthGuard } from '../src/modules/auth/session-auth.guard.js';
import { DashboardController } from '../src/modules/dashboard/dashboard.controller.js';
import { DashboardService } from '../src/modules/dashboard/dashboard.service.js';

describe('Dashboard private routes (e2e)', () => {
  let app: INestApplication<Server>;
  const login = vi.fn<AuthService['login']>();
  const authenticateSession = vi.fn<AuthService['authenticateSession']>();
  const logout = vi.fn<AuthService['logout']>();
  const sessionCookieOptions = vi.fn<AuthService['sessionCookieOptions']>();
  const getMetrics = vi.fn<DashboardService['getMetrics']>();
  const getPricingRules = vi.fn<DashboardService['getPricingRules']>();
  const updatePricingRules = vi.fn<DashboardService['updatePricingRules']>();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AuthController, DashboardController],
      providers: [
        SessionAuthGuard,
        {
          provide: AuthService,
          useValue: { authenticateSession, login, logout, sessionCookieOptions },
        },
        {
          provide: DashboardService,
          useValue: { getMetrics, getPricingRules, updatePricingRules },
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
    getPricingRules.mockResolvedValue({ rules: [] });
    updatePricingRules.mockResolvedValue({
      rules: [],
      updatedCount: 1,
      message: 'Precios actualizados correctamente.',
    });
  });

  it('logs in with correct credentials without exposing passwordHash', async () => {
    authenticateSession.mockResolvedValue({
      id: 'bb8bf7d2-e17c-44da-b456-b7240d30daf2',
      email: 'tatuador@example.com',
    });
    const expiresAt = new Date('2026-09-15T12:00:00.000Z');
    login.mockResolvedValue({
      sessionToken: 'valid-session-token',
      expiresAt,
      user: {
        id: 'bb8bf7d2-e17c-44da-b456-b7240d30daf2',
        email: 'tatuador@example.com',
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

  it('allows dashboard access with a valid session', async () => {
    authenticateSession.mockResolvedValue({
      id: 'bb8bf7d2-e17c-44da-b456-b7240d30daf2',
      email: 'tatuador@example.com',
    });

    await request(app.getHttpServer())
      .get('/api/dashboard/metrics')
      .set('Cookie', `${SESSION_COOKIE_NAME}=valid-session-token`)
      .expect(200);

    expect(authenticateSession).toHaveBeenCalledWith('valid-session-token');
    expect(getMetrics).toHaveBeenCalledOnce();
  });

  it('rejects reading and modifying prices without a session', async () => {
    await request(app.getHttpServer()).get('/api/dashboard/pricing').expect(401);
    await request(app.getHttpServer())
      .patch('/api/dashboard/pricing')
      .send({
        updates: [
          {
            pricingRuleId: '00000000-0000-4000-8000-000000000001',
            minPrice: 75,
            maxPrice: 85,
          },
        ],
      })
      .expect(401);

    expect(getPricingRules).not.toHaveBeenCalled();
    expect(updatePricingRules).not.toHaveBeenCalled();
  });

  it('uses the authenticated tattoo artist when updating prices', async () => {
    const tattooArtist = {
      id: 'bb8bf7d2-e17c-44da-b456-b7240d30daf2',
      email: 'tatuador@example.com',
    };
    const updates = [
      {
        pricingRuleId: '00000000-0000-4000-8000-000000000001',
        minPrice: 75,
        maxPrice: 85,
      },
    ];
    authenticateSession.mockResolvedValue(tattooArtist);

    await request(app.getHttpServer())
      .patch('/api/dashboard/pricing')
      .set('Cookie', `${SESSION_COOKIE_NAME}=valid-session-token`)
      .send({ updates })
      .expect(200);

    expect(updatePricingRules).toHaveBeenCalledWith(updates, tattooArtist.id);
  });

  it('rejects attempts to modify protected pricing rule fields', async () => {
    authenticateSession.mockResolvedValue({
      id: 'bb8bf7d2-e17c-44da-b456-b7240d30daf2',
      email: 'tatuador@example.com',
    });

    await request(app.getHttpServer())
      .patch('/api/dashboard/pricing')
      .set('Cookie', `${SESSION_COOKIE_NAME}=valid-session-token`)
      .send({
        updates: [
          {
            pricingRuleId: '00000000-0000-4000-8000-000000000001',
            minPrice: 75,
            maxPrice: 85,
            size: 'LARGE',
            detail: 'DETAILED',
            version: 99,
            isActive: false,
          },
        ],
      })
      .expect(400);

    expect(updatePricingRules).not.toHaveBeenCalled();
  });

  afterAll(async () => {
    await app.close();
  });
});

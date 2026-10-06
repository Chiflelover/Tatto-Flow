import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { ConversationAbandonmentController } from '../src/modules/conversations/conversation-abandonment.controller.js';
import { ConversationAbandonmentService } from '../src/modules/conversations/conversation-abandonment.service.js';

describe('Conversation abandonment HTTP authorization', () => {
  const secret = 'test-only-conversation-sweep-'.repeat(2);
  const path = '/api/conversations/abandon-inactive';
  let app: INestApplication<Server>;
  let configuredSecret: string | undefined;
  const abandonInactive = vi.fn().mockResolvedValue(2);

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ConversationAbandonmentController],
      providers: [
        { provide: ConfigService, useValue: { get: () => configuredSecret } },
        { provide: ConversationAbandonmentService, useValue: { abandonInactive } },
      ],
    }).compile();
    app = module.createNestApplication<INestApplication<Server>>();
    app.setGlobalPrefix('api');
    await app.init();
  });

  beforeEach(() => {
    configuredSecret = secret;
    abandonInactive.mockClear();
  });

  afterAll(async () => {
    await app?.close();
  });

  it.each([undefined, 'Bearer invalid', `Bearer ${secret.slice(0, -1)}X`])(
    'rejects unauthorized sweeps without invoking the service: %s',
    async (authorization) => {
      const call = request(app.getHttpServer()).get(path);
      if (authorization) call.set('Authorization', authorization);
      await call.expect(401);
      expect(abandonInactive).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, '', 'too-short'])(
    'fails closed when CRON_SECRET is missing or insufficient: %s',
    async (value) => {
      configuredSecret = value;
      await request(app.getHttpServer())
        .get(path)
        .set('Authorization', `Bearer ${secret}`)
        .expect(503);
      expect(abandonInactive).not.toHaveBeenCalled();
    },
  );

  it('allows the protected GET and returns only a non-cacheable count', async () => {
    await request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${secret}`)
      .expect('Cache-Control', 'no-store')
      .expect(200, { abandonedCount: 2 });
    expect(abandonInactive).toHaveBeenCalledOnce();
    expect(abandonInactive).toHaveBeenCalledWith();
  });
});

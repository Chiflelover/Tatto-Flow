import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { WhatsAppController } from '../src/modules/whatsapp/whatsapp.controller.js';
import { WhatsAppWebhookService } from '../src/modules/whatsapp/whatsapp-webhook.service.js';

describe('WhatsApp webhook (e2e)', () => {
  let app: INestApplication<Server>;
  const verifyChallenge = vi.fn();
  const handleWebhook = vi.fn();

  beforeEach(async () => {
    verifyChallenge.mockReturnValue('challenge-123');
    handleWebhook.mockResolvedValue({ received: true });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [WhatsAppController],
      providers: [
        {
          provide: WhatsAppWebhookService,
          useValue: { verifyChallenge, handleWebhook },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication<INestApplication<Server>>({ rawBody: true });
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await app.close();
  });

  it('exposes the GET verification endpoint expected by Meta', async () => {
    await request(app.getHttpServer())
      .get('/api/whatsapp/webhook')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'verify-token',
        'hub.challenge': 'challenge-123',
      })
      .expect(200)
      .expect('Content-Type', /text\/plain/)
      .expect('challenge-123');

    expect(verifyChallenge).toHaveBeenCalledWith('subscribe', 'verify-token', 'challenge-123');
  });

  it('preserves the exact POST body used by X-Hub-Signature-256', async () => {
    const body = { object: 'whatsapp_business_account', entry: [] };
    const serializedBody = JSON.stringify(body);
    const signature = `sha256=${'a'.repeat(64)}`;

    await request(app.getHttpServer())
      .post('/api/whatsapp/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signature)
      .send(serializedBody)
      .expect(200)
      .expect({ received: true });

    expect(handleWebhook).toHaveBeenCalledOnce();
    const [rawBody, receivedSignature] = handleWebhook.mock.calls[0] as [Buffer, string];
    expect(Buffer.isBuffer(rawBody)).toBe(true);
    expect(rawBody.toString('utf8')).toBe(serializedBody);
    expect(receivedSignature).toBe(signature);
  });
});

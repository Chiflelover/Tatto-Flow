import { Test, TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { InMemoryStorageService } from '../src/modules/storage/in-memory-storage.service.js';
import { StorageService } from '../src/modules/storage/storage.service.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<Server>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(StorageService)
      .useValue(new InMemoryStorageService())
      .compile();

    app = moduleFixture.createNestApplication<INestApplication<Server>>();
    app.setGlobalPrefix('api');
    await app.init();
  });

  it('/api/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect({ service: 'tatto-flow-backend', status: 'ok' });
  });

  it('does not expose the former WebChat HTTP endpoints', async () => {
    for (const path of [
      '/api/chatbot/start',
      '/api/chatbot/option',
      '/api/chatbot/text',
      '/api/chatbot/image',
    ]) {
      await request(app.getHttpServer()).post(path).expect(404);
    }
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });
});

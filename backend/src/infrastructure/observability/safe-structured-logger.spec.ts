import { SafeStructuredLogger } from './safe-structured-logger.js';

describe('SafeStructuredLogger', () => {
  it('removes secret fields, credentials, full phone numbers and database URLs', () => {
    const output: string[] = [];
    const sink = {
      log: vi.fn((message: string) => output.push(message)),
      warn: vi.fn((message: string) => output.push(message)),
      error: vi.fn((message: string) => output.push(message)),
    };
    const logger = new SafeStructuredLogger('test', sink);
    const previousToken = process.env.WHATSAPP_ACCESS_TOKEN;
    process.env.WHATSAPP_ACCESS_TOKEN = 'real-access-token';

    try {
      logger.info('privacy.test', {
        leadId: 'lead-1',
        conversationId: '157bc184-46f3-41ab-9430-13a1234567890',
        accessToken: 'real-access-token',
        password: 'real-password',
        phoneNumber: '51999888777',
        detail: 'Bearer real-access-token postgresql://user:pass@host/database phone 51999888777',
      });
    } finally {
      if (previousToken === undefined) {
        delete process.env.WHATSAPP_ACCESS_TOKEN;
      } else {
        process.env.WHATSAPP_ACCESS_TOKEN = previousToken;
      }
    }

    expect(output).toHaveLength(1);
    expect(output[0]).toContain('privacy.test');
    expect(output[0]).toContain('lead-1');
    expect(output[0]).toContain('157bc184-46f3-41ab-9430-13a1234567890');
    expect(output[0]).not.toContain('real-access-token');
    expect(output[0]).not.toContain('real-password');
    expect(output[0]).not.toContain('51999888777');
    expect(output[0]).not.toContain('user:pass');
  });

  it('never propagates a logger failure', () => {
    const sink = {
      log: vi.fn(() => {
        throw new Error('sink unavailable');
      }),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const logger = new SafeStructuredLogger('test', sink);

    expect(() => logger.info('logger.failure')).not.toThrow();
  });
});

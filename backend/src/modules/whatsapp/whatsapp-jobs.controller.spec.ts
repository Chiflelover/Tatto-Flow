import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { WhatsAppJobsController } from './whatsapp-jobs.controller.js';
import type { WhatsAppJobProcessor } from './whatsapp-job-processor.service.js';
describe('WhatsApp job recovery authorization', () => {
  const secret = 'test-recovery-secret-'.repeat(3);
  function fixture(configured = true) {
    const runNext = vi.fn().mockResolvedValue({ processed: false });
    return {
      runNext,
      controller: new WhatsAppJobsController(
        new ConfigService(configured ? { CRON_SECRET: secret } : {}),
        { runNext } as unknown as WhatsAppJobProcessor,
      ),
    };
  }
  it.each([undefined, 'Bearer wrong', ''])('rejects unauthorized recovery: %s', (value) => {
    const f = fixture();
    expect(() => f.controller.process(value)).toThrow(UnauthorizedException);
    expect(f.runNext).not.toHaveBeenCalled();
  });
  it('fails closed when recovery is unconfigured', () => {
    const f = fixture(false);
    expect(() => f.controller.process(undefined)).toThrow(ServiceUnavailableException);
    expect(f.runNext).not.toHaveBeenCalled();
  });
  it('allows authenticated GET/POST recovery without exposing inputs', async () => {
    const f = fixture();
    await expect(f.controller.process(`Bearer ${secret}`)).resolves.toEqual({ processed: false });
    await f.controller.processPost(`Bearer ${secret}`);
    expect(f.runNext).toHaveBeenCalledTimes(2);
  });
});

import { WhatsAppJobDispatcher } from './whatsapp-job-dispatcher.service.js';
import type { WhatsAppJobProcessor } from './whatsapp-job-processor.service.js';

const background = vi.hoisted(() => ({ waitUntil: vi.fn<(work: Promise<void>) => void>() }));
vi.mock('@vercel/functions', () => ({ waitUntil: background.waitUntil }));

describe('WhatsApp background dispatch', () => {
  beforeEach(() => background.waitUntil.mockReset());
  it('returns immediately and drains queued inputs in the background', async () => {
    const runNext = vi
      .fn()
      .mockResolvedValueOnce({ processed: true, status: 'COMPLETED' })
      .mockResolvedValue({ processed: false });
    const dispatcher = new WhatsAppJobDispatcher({ runNext } as unknown as WhatsAppJobProcessor);
    expect(dispatcher.wake('account', 'customer')).toBeUndefined();
    expect(runNext).not.toHaveBeenCalled();
    expect(background.waitUntil).toHaveBeenCalledOnce();
    await background.waitUntil.mock.calls[0][0];
    expect(runNext).toHaveBeenCalledTimes(2);
    expect(runNext).toHaveBeenNthCalledWith(1, 'account', 'customer');
  });
  it.each(['RETRYABLE', 'UNKNOWN', 'FAILED'])('does not spin on %s jobs', async (status) => {
    const runNext = vi.fn().mockResolvedValue({ processed: true, status });
    new WhatsAppJobDispatcher({ runNext } as unknown as WhatsAppJobProcessor).wake(
      'account',
      'customer',
    );
    await background.waitUntil.mock.calls[0][0];
    expect(runNext).toHaveBeenCalledOnce();
  });
  it('leaves remaining work durable when an invocation has spent its drain budget', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(31_000);
    try {
      const runNext = vi.fn().mockResolvedValue({ processed: true, status: 'COMPLETED' });
      new WhatsAppJobDispatcher({ runNext } as unknown as WhatsAppJobProcessor).wake(
        'account',
        'customer',
      );
      await background.waitUntil.mock.calls[0][0];
      expect(runNext).toHaveBeenCalledOnce();
    } finally {
      now.mockRestore();
    }
  });
});

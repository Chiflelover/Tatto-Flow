import { LeadImageRetentionService } from './lead-image-retention.service.js';
import { RetentionCronController } from './retention-cron.controller.js';

describe('RetentionCronController', () => {
  it('runs the existing expired-image cleanup', async () => {
    const result = { found: 2, completed: 2, failed: 0 };
    const cleanupExpiredImages = vi.fn().mockResolvedValue(result);
    const controller = new RetentionCronController({
      cleanupExpiredImages,
    } as unknown as LeadImageRetentionService);

    await expect(controller.cleanupExpiredImages()).resolves.toEqual(result);
    expect(cleanupExpiredImages).toHaveBeenCalledOnce();
  });
});

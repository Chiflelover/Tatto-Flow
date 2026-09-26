import { GUARDS_METADATA } from '@nestjs/common/constants';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { DashboardController } from './dashboard.controller.js';

describe('DashboardController security', () => {
  it('protects every dashboard route, including signed image URLs, at controller level', () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, DashboardController) as unknown[];

    expect(guards).toContain(SessionAuthGuard);
  });

  it('forwards a validated final price to the dashboard service', async () => {
    const saveManualFinalPrice = vi.fn().mockResolvedValue({ manualFinalPrice: '650.00' });
    const controller = new DashboardController({ saveManualFinalPrice } as never);
    const leadId = '290f2044-e63c-4e49-8847-067cd62426e4';

    await expect(controller.saveManualFinalPrice(leadId, { price: 650 })).resolves.toEqual({
      manualFinalPrice: '650.00',
    });
    expect(saveManualFinalPrice).toHaveBeenCalledWith(leadId, 650);
  });
});

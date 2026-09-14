import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { CustomersService } from './customers.service.js';

describe('CustomersService out-of-hours notice', () => {
  it('claims one notice atomically for a closed period', async () => {
    const updateMany = vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const service = new CustomersService({
      customer: { updateMany },
    } as unknown as PrismaService);

    await expect(service.claimOutOfHoursNotice('customer-id', '2026-09-14')).resolves.toBe(true);
    await expect(service.claimOutOfHoursNotice('customer-id', '2026-09-14')).resolves.toBe(false);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'customer-id',
        OR: [
          { lastOutOfHoursNoticeKey: null },
          { lastOutOfHoursNoticeKey: { not: '2026-09-14' } },
        ],
      },
      data: { lastOutOfHoursNoticeKey: '2026-09-14' },
    });
  });

  it('rejects an invalid closed-period key before touching the database', async () => {
    const updateMany = vi.fn();
    const service = new CustomersService({
      customer: { updateMany },
    } as unknown as PrismaService);

    await expect(service.claimOutOfHoursNotice('customer-id', 'night')).rejects.toThrow(
      'Closed period key must use YYYY-MM-DD.',
    );
    expect(updateMany).not.toHaveBeenCalled();
  });
});

import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { CustomersService } from './customers.service.js';

describe('CustomersService account isolation', () => {
  it('keeps the same customer phone in two separate artist accounts', async () => {
    const customers = new Map<string, { id: string; accountId: string; phoneNumber: string }>();
    const upsert = vi.fn(
      ({
        where,
        create,
      }: {
        where: { accountId_phoneNumber: { accountId: string; phoneNumber: string } };
        create: { accountId: string; phoneNumber: string };
      }) => {
        const key = `${where.accountId_phoneNumber.accountId}:${where.accountId_phoneNumber.phoneNumber}`;
        let customer = customers.get(key);
        if (!customer) {
          customer = { id: `customer-${customers.size + 1}`, ...create };
          customers.set(key, customer);
        }
        return Promise.resolve(customer);
      },
    );
    const service = new CustomersService({ customer: { upsert } } as unknown as PrismaService);
    const accountA = '00000000-0000-4000-8000-000000000001';
    const accountB = '00000000-0000-4000-8000-000000000002';

    const a = await service.findOrCreateByPhoneNumber(accountA, ' 51999111222 ');
    const b = await service.findOrCreateByPhoneNumber(accountB, '51999111222');
    const aAgain = await service.findOrCreateByPhoneNumber(accountA, '51999111222');

    expect(a.id).not.toBe(b.id);
    expect(aAgain.id).toBe(a.id);
    expect(customers.size).toBe(2);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { accountId_phoneNumber: { accountId: accountB, phoneNumber: '51999111222' } },
      }),
    );
  });
});

describe('CustomersService out-of-hours notice', () => {
  it('claims one notice atomically for a closed period', async () => {
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const service = new CustomersService({
      customer: { updateMany },
    } as unknown as PrismaService);

    await expect(service.claimOutOfHoursNotice('customer-id', '2026-09-14')).resolves.toBe(true);
    await expect(service.claimOutOfHoursNotice('customer-id', '2026-09-14')).resolves.toBe(false);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 'customer-id',
        OR: [{ lastOutOfHoursNoticeKey: null }, { lastOutOfHoursNoticeKey: { not: '2026-09-14' } }],
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

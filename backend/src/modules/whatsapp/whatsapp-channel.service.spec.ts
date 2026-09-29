import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { WhatsAppChannelService } from './whatsapp-channel.service.js';

describe('WhatsAppChannelService', () => {
  it('resolves two Nita phone_number_ids to distinct active accounts and ignores a disabled account', async () => {
    const findUnique = vi.fn(({ where }: { where: { phoneNumberId: string } }) =>
      Promise.resolve(
        {
          '111': { accountId: 'account-a', phoneNumberId: '111', account: { isActive: true } },
          '222': { accountId: 'account-b', phoneNumberId: '222', account: { isActive: true } },
          '333': { accountId: 'account-c', phoneNumberId: '333', account: { isActive: false } },
        }[where.phoneNumberId as '111' | '222' | '333'] ?? null,
      ),
    );
    const service = new WhatsAppChannelService(
      { whatsAppChannel: { findUnique } } as unknown as PrismaService,
      new ConfigService({}),
    );

    expect((await service.resolve('111'))?.accountId).toBe('account-a');
    expect((await service.resolve('222'))?.accountId).toBe('account-b');
    expect(await service.resolve('333')).toBeNull();
    expect(await service.resolve('444')).toBeNull();
  });
});

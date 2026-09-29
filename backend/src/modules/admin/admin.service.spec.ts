import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { verifyPassword } from '../auth/password-hasher.js';
import { AdminService } from './admin.service.js';

const ACCOUNT_ID = '00000000-0000-4000-8000-000000000002';
const PASSWORD = 'Una-clave-segura-123';

describe('AdminService account management', () => {
  it('creates an artist user and unique Nita channel in one transaction with a hashed password', async () => {
    const create = vi.fn().mockResolvedValue({ id: ACCOUNT_ID });
    const findMany = vi.fn().mockResolvedValue([]);
    const get = vi.fn().mockResolvedValue({
      id: ACCOUNT_ID,
      name: 'Tatuador A',
      isActive: true,
      user: { email: 'artist-a@example.com' },
      channel: { phoneNumber: '51999888777', phoneNumberId: '12345' },
      createdAt: new Date('2026-09-29T12:00:00Z'),
    });
    const tx = { tattooArtistAccount: { create }, pricingRule: { findMany } };
    const service = new AdminService({
      tattooArtistAccount: { findUnique: get },
      $transaction: vi.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    } as unknown as PrismaService);

    const result = await service.createAccount({
      name: ' Tatuador A ',
      email: 'ARTIST-A@example.com',
      password: PASSWORD,
      phoneNumber: '+51 999 888 777',
      phoneNumberId: '12345',
      isActive: true,
    });

    const data = (
      create.mock.calls[0]?.[0] as unknown as {
        data: {
          user: { create: { email: string; passwordHash: string } };
          channel: { create: { phoneNumber: string; phoneNumberId: string } };
        };
      }
    ).data;
    expect(data.user.create.email).toBe('artist-a@example.com');
    expect(data.user.create.passwordHash).not.toBe(PASSWORD);
    expect(await verifyPassword(PASSWORD, data.user.create.passwordHash)).toBe(true);
    expect(data.channel.create).toEqual({ phoneNumber: '51999888777', phoneNumberId: '12345' });
    expect(result.contactUrl).toBe('https://wa.me/51999888777');
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('invalidates sessions after an admin resets the artist password', async () => {
    const account = {
      id: ACCOUNT_ID,
      name: 'Tatuador A',
      isActive: true,
      user: { email: 'artist-a@example.com' },
      channel: null,
      createdAt: new Date('2026-09-29T12:00:00Z'),
    };
    const findUnique = vi.fn().mockResolvedValue(account);
    const update = vi.fn().mockResolvedValue(account);
    const userFindUnique = vi.fn().mockResolvedValue({ id: 'artist-user-id' });
    const userUpdate = vi.fn().mockResolvedValue(undefined);
    const deleteMany = vi.fn().mockResolvedValue({ count: 2 });
    const tx = {
      tattooArtistAccount: { update },
      user: { findUnique: userFindUnique, update: userUpdate },
      authSession: { deleteMany },
    };
    const service = new AdminService({
      tattooArtistAccount: { findUnique },
      $transaction: vi.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    } as unknown as PrismaService);

    await service.updateAccount(ACCOUNT_ID, { password: 'Otra-clave-segura-456' });

    expect(deleteMany).toHaveBeenCalledWith({ where: { userId: 'artist-user-id' } });
    const passwordHash = (
      userUpdate.mock.calls[0]?.[0] as unknown as {
        data: { passwordHash: string };
      }
    ).data.passwordHash;
    expect(await verifyPassword('Otra-clave-segura-456', passwordHash)).toBe(true);
  });

  it('revokes artist sessions when an admin deactivates the account', async () => {
    const account = {
      id: ACCOUNT_ID,
      name: 'Tatuador A',
      isActive: false,
      user: { email: 'artist-a@example.com' },
      channel: null,
      createdAt: new Date('2026-09-29T12:00:00Z'),
    };
    const update = vi.fn().mockResolvedValue(account);
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      tattooArtistAccount: { update },
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'artist-user-id' }) },
      authSession: { deleteMany },
    };
    const service = new AdminService({
      tattooArtistAccount: { findUnique: vi.fn().mockResolvedValue(account) },
      $transaction: vi.fn((callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    } as unknown as PrismaService);

    await service.updateAccount(ACCOUNT_ID, { isActive: false });

    expect(update).toHaveBeenCalledWith({ where: { id: ACCOUNT_ID }, data: { isActive: false } });
    expect(deleteMany).toHaveBeenCalledWith({ where: { userId: 'artist-user-id' } });
  });
});

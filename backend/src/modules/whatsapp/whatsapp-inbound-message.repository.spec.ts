import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { WhatsAppInboundMessageRepository } from './whatsapp-inbound-message.repository.js';

describe('WhatsAppInboundMessageRepository', () => {
  it('claims a WhatsApp message ID only when PostgreSQL inserts it', async () => {
    const executeRaw = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const repository = new WhatsAppInboundMessageRepository({
      $executeRaw: executeRaw,
    } as unknown as PrismaService);

    await expect(repository.claim('wamid.unique')).resolves.toBe(true);
    await expect(repository.claim('wamid.unique')).resolves.toBe(false);
    expect(executeRaw).toHaveBeenCalledTimes(2);
  });

  it('releases a failed claim so Meta can retry it', async () => {
    const executeRaw = vi.fn().mockResolvedValue(1);
    const repository = new WhatsAppInboundMessageRepository({
      $executeRaw: executeRaw,
    } as unknown as PrismaService);

    await repository.release('wamid.retry');

    expect(executeRaw).toHaveBeenCalledOnce();
  });

  it('rejects an empty or oversized message ID', async () => {
    const repository = new WhatsAppInboundMessageRepository({} as PrismaService);

    await expect(repository.claim('')).rejects.toBeInstanceOf(BadRequestException);
    await expect(repository.claim('x'.repeat(256))).rejects.toBeInstanceOf(BadRequestException);
  });
});

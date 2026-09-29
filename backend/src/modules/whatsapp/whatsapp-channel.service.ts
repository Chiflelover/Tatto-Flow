import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { LEGACY_ACCOUNT_ID, normalizeNitaNumber } from '../accounts/account.constants.js';

@Injectable()
export class WhatsAppChannelService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  async resolve(phoneNumberId: string) {
    const channel = await this.prisma.whatsAppChannel.findUnique({
      where: { phoneNumberId },
      include: { account: true },
    });
    if (channel) return channel.account.isActive ? channel : null;

    // Keep the original v0.1 channel working after the additive migration.
    const legacyId = this.config.get<string>('WHATSAPP_PHONE_NUMBER_ID')?.trim();
    const legacyNumber = this.config.get<string>('WHATSAPP_NITA_NUMBER')?.trim();
    if (phoneNumberId !== legacyId || !legacyNumber || !/^\d+$/.test(phoneNumberId)) return null;

    const account = await this.prisma.tattooArtistAccount.findUnique({
      where: { id: LEGACY_ACCOUNT_ID },
    });
    if (!account?.isActive) return null;

    const normalizedNumber = normalizeNitaNumber(legacyNumber);
    const provisioned = await this.prisma.whatsAppChannel.upsert({
      where: { accountId: LEGACY_ACCOUNT_ID },
      create: {
        accountId: LEGACY_ACCOUNT_ID,
        phoneNumber: normalizedNumber,
        phoneNumberId,
      },
      update: {},
      include: { account: true },
    });
    return provisioned.phoneNumberId === phoneNumberId ? provisioned : null;
  }
}

import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import {
  contactUrl,
  LEGACY_ACCOUNT_ID,
  normalizeNitaNumber,
} from '../accounts/account.constants.js';
import { hashPassword } from '../auth/password-hasher.js';
import type { CreateArtistAccountDto, UpdateArtistAccountDto } from './dto/admin-account.dto.js';

const ACCOUNT_INCLUDE = {
  user: { select: { email: true } },
  channel: { select: { phoneNumber: true, phoneNumberId: true } },
} satisfies Prisma.TattooArtistAccountInclude;

@Injectable()
export class AdminService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async listAccounts() {
    const accounts = await this.prisma.tattooArtistAccount.findMany({
      include: ACCOUNT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return accounts.map((account) => this.view(account));
  }

  async getAccount(id: string) {
    const account = await this.prisma.tattooArtistAccount.findUnique({
      where: { id },
      include: ACCOUNT_INCLUDE,
    });
    if (!account) throw new NotFoundException('No encontramos esa cuenta.');
    return this.view(account);
  }

  async createAccount(dto: CreateArtistAccountDto) {
    const phoneNumber = this.validNumber(dto.phoneNumber);
    const passwordHash = await hashPassword(dto.password);
    const email = dto.email.trim().toLowerCase();
    const name = dto.name.trim();
    if (!name) throw new ConflictException('El nombre no puede estar vacío.');

    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const account = await tx.tattooArtistAccount.create({
          data: {
            name,
            isActive: dto.isActive,
            user: { create: { email, passwordHash, role: UserRole.TATTOO_ARTIST } },
            channel: { create: { phoneNumber, phoneNumberId: dto.phoneNumberId } },
          },
        });
        const legacyRules = await tx.pricingRule.findMany({
          where: { accountId: LEGACY_ACCOUNT_ID, isActive: true },
        });
        if (legacyRules.length) {
          await tx.pricingRule.createMany({
            data: legacyRules.map(({ size, detail, minPrice, maxPrice }) => ({
              accountId: account.id,
              size,
              detail,
              minPrice,
              maxPrice,
            })),
          });
        }
        return account.id;
      });
      return this.getAccount(id);
    } catch (error) {
      this.rethrowConflict(error);
    }
  }

  async updateAccount(id: string, dto: UpdateArtistAccountDto) {
    await this.getAccount(id);
    const name = dto.name?.trim();
    if (dto.name !== undefined && !name)
      throw new ConflictException('El nombre no puede estar vacío.');
    const phoneNumber =
      dto.phoneNumber === undefined ? undefined : this.validNumber(dto.phoneNumber);
    const passwordHash = dto.password === undefined ? undefined : await hashPassword(dto.password);

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.tattooArtistAccount.update({
          where: { id },
          data: {
            ...(name ? { name } : {}),
            ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
          },
        });
        if (phoneNumber !== undefined || dto.phoneNumberId !== undefined) {
          const existingChannel = await tx.whatsAppChannel.findUnique({ where: { accountId: id } });
          if (!existingChannel && (!phoneNumber || !dto.phoneNumberId)) {
            throw new ConflictException(
              'Indica número de Nita y phone_number_id para asociar el canal.',
            );
          }
          await tx.whatsAppChannel.upsert({
            where: { accountId: id },
            update: {
              ...(phoneNumber ? { phoneNumber } : {}),
              ...(dto.phoneNumberId ? { phoneNumberId: dto.phoneNumberId } : {}),
            },
            create: { accountId: id, phoneNumber: phoneNumber!, phoneNumberId: dto.phoneNumberId! },
          });
        }
        if (passwordHash !== undefined || dto.isActive === false) {
          const user = await tx.user.findUnique({ where: { accountId: id }, select: { id: true } });
          if (!user && passwordHash !== undefined)
            throw new NotFoundException('La cuenta no tiene acceso de tatuador.');
          if (user) {
            if (passwordHash !== undefined) {
              await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
            }
            await tx.authSession.deleteMany({ where: { userId: user.id } });
          }
        }
      });
      return this.getAccount(id);
    } catch (error) {
      this.rethrowConflict(error);
    }
  }

  private validNumber(value: string): string {
    try {
      return normalizeNitaNumber(value);
    } catch {
      throw new ConflictException(
        'El número de Nita debe incluir código de país y tener entre 8 y 15 dígitos.',
      );
    }
  }

  private rethrowConflict(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ConflictException('El correo, número de Nita o phone_number_id ya está asignado.');
    }
    throw error;
  }

  private view(account: Prisma.TattooArtistAccountGetPayload<{ include: typeof ACCOUNT_INCLUDE }>) {
    return {
      id: account.id,
      name: account.name,
      isActive: account.isActive,
      email: account.user?.email ?? null,
      phoneNumber: account.channel?.phoneNumber ?? null,
      phoneNumberId: account.channel?.phoneNumberId ?? null,
      contactUrl: account.channel ? contactUrl(account.channel.phoneNumber) : null,
      createdAt: account.createdAt.toISOString(),
    };
  }
}

import { Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import type { ImageListQueryDto } from './image-management.dto.js';

const SIGNED_URL_TTL_SECONDS = 300;

type ImageDeletionResult =
  | { id: string; status: 'deleted' | 'already_deleted' | 'not_found' }
  | { id: string; status: 'retry_required'; stage: 'lookup' | 'storage' | 'metadata' };

@Injectable()
export class ImageManagementService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(StorageService) private readonly storage: StorageService,
  ) {}

  async listAll(query: ImageListQueryDto) {
    const from = query.from ? new Date(`${query.from.slice(0, 10)}T00:00:00.000Z`) : undefined;
    const to = query.to
      ? new Date(new Date(`${query.to.slice(0, 10)}T00:00:00.000Z`).getTime() + 86400000)
      : undefined;
    const where: Prisma.LeadImageWhereInput = {
      deletedAt: null,
      ...(from || to ? { createdAt: { gte: from, lt: to } } : {}),
      lead: {
        ...(query.accountId ? { accountId: query.accountId } : {}),
        ...(query.phone
          ? { customer: { phoneNumber: { contains: query.phone.replace(/\D/g, '') } } }
          : {}),
      },
    };
    const [total, images] = await Promise.all([
      this.prisma.leadImage.count({ where }),
      this.prisma.leadImage.findMany({
        where,
        include: {
          lead: {
            select: {
              id: true,
              accountId: true,
              account: { select: { name: true } },
              customer: { select: { phoneNumber: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    const items = await Promise.all(
      images.map(async (image) => {
        let previewUrl: string | null = null;
        try {
          if (await this.storage.exists(image.storagePath))
            previewUrl = await this.storage.createSignedUrl(
              image.storagePath,
              SIGNED_URL_TTL_SECONDS,
            );
        } catch {
          /* The metadata remains visible if Storage is temporarily unavailable. */
        }
        return {
          id: image.id,
          accountId: image.lead.accountId,
          accountName: image.lead.account.name,
          customerPhoneNumber: image.lead.customer.phoneNumber,
          leadId: image.leadId,
          createdAt: image.createdAt.toISOString(),
          previewUrl,
        };
      }),
    );
    return {
      images: items,
      page: query.page,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async deleteMany(ids: string[], adminUserId: string) {
    const results: ImageDeletionResult[] = [];
    for (const id of new Set(ids)) {
      let image;
      try {
        image = await this.prisma.leadImage.findUnique({ where: { id } });
      } catch {
        results.push({ id, status: 'retry_required', stage: 'lookup' });
        continue;
      }
      if (!image) {
        results.push({ id, status: 'not_found' });
        continue;
      }
      if (image.deletedAt) {
        results.push({ id, status: 'already_deleted' });
        continue;
      }
      try {
        await this.storage.delete(image.storagePath);
      } catch {
        results.push({ id, status: 'retry_required', stage: 'storage' });
        continue;
      }
      try {
        const updated = await this.prisma.leadImage.updateMany({
          where: { id, deletedAt: null },
          data: { deletedAt: new Date(), deletedByUserId: adminUserId },
        });
        if (updated.count === 1) {
          results.push({ id, status: 'deleted' });
          continue;
        }
        const current = await this.prisma.leadImage.findUnique({ where: { id } });
        if (!current) results.push({ id, status: 'not_found' });
        else if (current.deletedAt) results.push({ id, status: 'already_deleted' });
        else results.push({ id, status: 'retry_required', stage: 'metadata' });
      } catch {
        results.push({ id, status: 'retry_required', stage: 'metadata' });
      }
    }
    return {
      deletedCount: results.filter((result) => result.status === 'deleted').length,
      results,
    };
  }

  async artistDownload(accountId: string, imageId: string) {
    const image = await this.prisma.leadImage.findFirst({
      where: { id: imageId, deletedAt: null, lead: { accountId } },
      select: { storagePath: true, leadId: true },
    });
    if (!image) throw new NotFoundException('Imagen no disponible para esta cuenta.');
    const extension = /\.(jpg|png|webp)$/i.exec(image.storagePath)?.[1]?.toLowerCase();
    if (!extension) throw new ServiceUnavailableException('Formato de imagen no disponible.');
    const fileName = `referencia-${image.leadId.slice(0, 8)}.${extension}`;
    try {
      if (!(await this.storage.exists(image.storagePath)))
        throw new NotFoundException('Imagen eliminada.');
      return {
        url: await this.storage.createSignedUrl(
          image.storagePath,
          SIGNED_URL_TTL_SECONDS,
          fileName,
        ),
        fileName,
        expiresInSeconds: SIGNED_URL_TTL_SECONDS,
      };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new ServiceUnavailableException('No pudimos preparar la descarga de la imagen.');
    }
  }
}

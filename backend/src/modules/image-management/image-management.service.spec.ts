/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { StorageService } from '../storage/storage.service.js';
import { ImageManagementService } from './image-management.service.js';

const imageIdA = '00000000-0000-4000-8000-000000000101';
const imageIdB = '00000000-0000-4000-8000-000000000102';
const imageIdC = '00000000-0000-4000-8000-000000000103';
const accountA = '00000000-0000-4000-8000-000000000001';
const accountB = '00000000-0000-4000-8000-000000000002';
const leadId = '290f2044-e63c-4e49-8847-067cd62426e4';
const storagePath = `leads/${leadId}/bf3b934c-8338-45f3-992f-3ad65c3ce537.jpg`;

function fixture() {
  const findMany = vi.fn().mockResolvedValue([
    {
      id: imageIdA,
      leadId,
      storagePath,
      createdAt: new Date('2025-01-01'),
      lead: {
        accountId: accountA,
        account: { name: 'A' },
        customer: { phoneNumber: '51999999999' },
      },
    },
    {
      id: imageIdB,
      leadId,
      storagePath,
      createdAt: new Date('2025-01-02'),
      lead: {
        accountId: accountB,
        account: { name: 'B' },
        customer: { phoneNumber: '51888888888' },
      },
    },
  ]);
  const count = vi.fn().mockResolvedValue(2);
  const findUnique = vi
    .fn()
    .mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve({ id: where.id, storagePath, deletedAt: null }),
    );
  const findFirst = vi
    .fn()
    .mockImplementation(({ where }: { where: { lead: { accountId: string } } }) =>
      Promise.resolve(where.lead.accountId === accountA ? { leadId, storagePath } : null),
    );
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const deleteObject = vi.fn().mockResolvedValue('deleted');
  const exists = vi.fn().mockResolvedValue(true);
  const createSignedUrl = vi.fn().mockResolvedValue('https://storage.example/signed');
  const prisma = {
    leadImage: { findMany, count, findUnique, findFirst, updateMany },
  } as unknown as PrismaService;
  const storage = { delete: deleteObject, exists, createSignedUrl } as unknown as StorageService;
  return {
    service: new ImageManagementService(prisma, storage),
    findMany,
    count,
    findUnique,
    findFirst,
    updateMany,
    deleteObject,
    exists,
    createSignedUrl,
  };
}

describe('ImageManagementService', () => {
  it('lists images from all accounts for ADMIN and supports filters and pagination', async () => {
    const { service, findMany, count } = fixture();
    const result = await service.listAll({ page: 1, pageSize: 50 });
    expect(result.images.map((item) => item.accountName)).toEqual(['A', 'B']);
    expect(result.total).toBe(2);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null, lead: {} }, take: 50, skip: 0 }),
    );
    await service.listAll({
      accountId: accountA,
      from: '2025-01-01',
      to: '2025-01-31',
      phone: '+51 999',
      page: 2,
      pageSize: 1,
    });
    expect(count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        lead: expect.objectContaining({
          accountId: accountA,
          customer: { phoneNumber: { contains: '51999' } },
        }),
      }),
    });
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 1, take: 1 }));
  });

  it('deletes one or several objects manually, records ADMIN, and never deletes leads', async () => {
    const { service, deleteObject, updateMany } = fixture();
    const result = await service.deleteMany([imageIdA, imageIdB, imageIdA], 'admin-id');
    expect(result.deletedCount).toBe(2);
    expect(result.results).toEqual([
      { id: imageIdA, status: 'deleted' },
      { id: imageIdB, status: 'deleted' },
    ]);
    expect(deleteObject).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: imageIdA, deletedAt: null },
      data: { deletedAt: expect.any(Date), deletedByUserId: 'admin-id' },
    });
  });

  it('treats an already deleted image as complete without changing its audit trail', async () => {
    const { service, findUnique, deleteObject, updateMany } = fixture();
    findUnique.mockResolvedValueOnce({
      id: imageIdA,
      storagePath,
      deletedAt: new Date('2025-01-03'),
      deletedByUserId: 'original-admin',
    });
    await expect(service.deleteMany([imageIdA], 'another-admin')).resolves.toEqual({
      deletedCount: 0,
      results: [{ id: imageIdA, status: 'already_deleted' }],
    });
    expect(deleteObject).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('records deletion even when the Storage object was already missing', async () => {
    const { service, deleteObject, updateMany } = fixture();
    deleteObject.mockResolvedValueOnce('missing');
    await expect(service.deleteMany([imageIdA], 'admin-id')).resolves.toEqual({
      deletedCount: 1,
      results: [{ id: imageIdA, status: 'deleted' }],
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: imageIdA, deletedAt: null },
      data: { deletedAt: expect.any(Date), deletedByUserId: 'admin-id' },
    });
  });

  it('reports each batch failure and continues with the next image', async () => {
    const { service, findUnique, deleteObject, updateMany } = fixture();
    findUnique.mockRejectedValueOnce(new Error('database unavailable'));
    deleteObject.mockRejectedValueOnce(new Error('storage unavailable'));
    const result = await service.deleteMany([imageIdA, imageIdB, imageIdC], 'admin-id');
    expect(result).toEqual({
      deletedCount: 1,
      results: [
        { id: imageIdA, status: 'retry_required', stage: 'lookup' },
        { id: imageIdB, status: 'retry_required', stage: 'storage' },
        { id: imageIdC, status: 'deleted' },
      ],
    });
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it('can complete a retry after Storage succeeded but the metadata update failed', async () => {
    const { service, deleteObject, updateMany } = fixture();
    updateMany.mockRejectedValueOnce(new Error('database unavailable'));
    expect((await service.deleteMany([imageIdA], 'admin-id')).results).toEqual([
      { id: imageIdA, status: 'retry_required', stage: 'metadata' },
    ]);
    deleteObject.mockResolvedValueOnce('missing');
    expect((await service.deleteMany([imageIdA], 'admin-id')).results).toEqual([
      { id: imageIdA, status: 'deleted' },
    ]);
  });

  it('recognizes concurrent deletion without overwriting the first ADMIN audit trail', async () => {
    const { service, findUnique, updateMany } = fixture();
    updateMany.mockResolvedValueOnce({ count: 0 });
    findUnique.mockResolvedValueOnce({ id: imageIdA, storagePath, deletedAt: null });
    findUnique.mockResolvedValueOnce({
      id: imageIdA,
      storagePath,
      deletedAt: new Date('2025-01-03'),
      deletedByUserId: 'first-admin',
    });
    expect((await service.deleteMany([imageIdA], 'second-admin')).results).toEqual([
      { id: imageIdA, status: 'already_deleted' },
    ]);
  });

  it('only signs an artist own image for download, preserving its original extension', async () => {
    const { service, findFirst, createSignedUrl } = fixture();
    await expect(service.artistDownload(accountA, imageIdA)).resolves.toEqual({
      url: 'https://storage.example/signed',
      fileName: `referencia-${leadId.slice(0, 8)}.jpg`,
      expiresInSeconds: 300,
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: imageIdA, deletedAt: null, lead: { accountId: accountA } },
      select: { storagePath: true, leadId: true },
    });
    expect(createSignedUrl).toHaveBeenCalledWith(
      storagePath,
      300,
      `referencia-${leadId.slice(0, 8)}.jpg`,
    );
    await expect(service.artistDownload(accountB, imageIdA)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('does not sign an image after manual deletion or when Storage is missing', async () => {
    const { service, findFirst, exists, createSignedUrl } = fixture();
    findFirst.mockResolvedValueOnce(null);
    await expect(service.artistDownload(accountA, imageIdA)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    exists.mockResolvedValueOnce(false);
    await expect(service.artistDownload(accountA, imageIdA)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(createSignedUrl).not.toHaveBeenCalled();
  });
});

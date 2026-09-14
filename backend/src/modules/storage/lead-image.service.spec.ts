import type { LeadImage } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { LeadImageService, LeadImageStorageException } from './lead-image.service.js';
import { StorageService } from './storage.service.js';

const LEAD_ID = '290f2044-e63c-4e49-8847-067cd62426e4';
const FIFTEEN_DAYS_MS = 15 * 24 * 60 * 60 * 1000;
const VALID_PNG = {
  content: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  mimeType: 'image/png',
  fileName: '../../not-used.png',
};

function createFixture(
  options: { existing?: LeadImage; uploadError?: boolean; dbError?: boolean } = {},
) {
  const findFirst = vi.fn().mockResolvedValue(options.existing ?? null);
  const create = vi.fn((arguments_: { data: Omit<LeadImage, 'id' | 'deletedAt'> }) => {
    if (options.dbError) {
      return Promise.reject(new Error('database unavailable'));
    }

    return Promise.resolve({
      id: 'c29080d9-49de-4d6e-bea2-6017cbe109f8',
      deletedAt: null,
      ...arguments_.data,
    } satisfies LeadImage);
  });
  const upload = options.uploadError
    ? vi.fn().mockRejectedValue(new Error('storage unavailable'))
    : vi.fn().mockResolvedValue(undefined);
  const remove = vi.fn().mockResolvedValue('deleted');
  const prisma = { leadImage: { findFirst, create } } as unknown as PrismaService;
  const storage = { upload, delete: remove } as unknown as StorageService;

  return {
    service: new LeadImageService(prisma, storage),
    findFirst,
    create,
    upload,
    remove,
  };
}

describe('LeadImageService', () => {
  it('uploads a safe object and creates LeadImage metadata with 15-day retention', async () => {
    const fixture = createFixture();

    const image = await fixture.service.ensureStored(LEAD_ID, VALID_PNG);

    const uploadInput = fixture.upload.mock.calls[0]?.[0] as {
      path: string;
      contentType: string;
    };
    expect(uploadInput.path).toMatch(new RegExp(`^leads/${LEAD_ID}/[0-9a-f-]{36}\\.png$`, 'i'));
    expect(uploadInput.path).not.toContain('not-used');
    expect(uploadInput.contentType).toBe('image/png');
    expect(image.storagePath).toBe(uploadInput.path);
    expect(image.expiresAt.getTime() - image.createdAt.getTime()).toBe(FIFTEEN_DAYS_MS);
    expect(image.deletedAt).toBeNull();
  });

  it('does not create LeadImage when upload fails', async () => {
    const fixture = createFixture({ uploadError: true });

    await expect(fixture.service.ensureStored(LEAD_ID, VALID_PNG)).rejects.toBeInstanceOf(
      LeadImageStorageException,
    );
    expect(fixture.create).not.toHaveBeenCalled();
  });

  it('compensates the uploaded object when metadata persistence fails', async () => {
    const fixture = createFixture({ dbError: true });

    await expect(fixture.service.ensureStored(LEAD_ID, VALID_PNG)).rejects.toBeInstanceOf(
      LeadImageStorageException,
    );
    expect(fixture.upload).toHaveBeenCalledOnce();
    const uploadInput = fixture.upload.mock.calls[0]?.[0] as { path: string };
    expect(fixture.remove).toHaveBeenCalledWith(uploadInput.path);
  });

  it('reuses an existing current reference without uploading a duplicate', async () => {
    const now = new Date();
    const existing: LeadImage = {
      id: 'c29080d9-49de-4d6e-bea2-6017cbe109f8',
      leadId: LEAD_ID,
      storagePath: `leads/${LEAD_ID}/bf3b934c-8338-45f3-992f-3ad65c3ce537.png`,
      createdAt: now,
      expiresAt: new Date(now.getTime() + FIFTEEN_DAYS_MS),
      deletedAt: null,
    };
    const fixture = createFixture({ existing });

    await expect(fixture.service.ensureStored(LEAD_ID, VALID_PNG)).resolves.toBe(existing);
    expect(fixture.upload).not.toHaveBeenCalled();
    expect(fixture.create).not.toHaveBeenCalled();
  });
});

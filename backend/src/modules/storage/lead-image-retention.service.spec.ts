import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { LeadImageRetentionService } from './lead-image-retention.service.js';
import { StorageService } from './storage.service.js';

const NOW = new Date('2026-09-14T12:00:00.000Z');
const IMAGE = {
  id: 'c29080d9-49de-4d6e-bea2-6017cbe109f8',
  storagePath:
    'leads/290f2044-e63c-4e49-8847-067cd62426e4/bf3b934c-8338-45f3-992f-3ad65c3ce537.png',
};

function createFixture(
  findResults: Array<(typeof IMAGE)[]> = [[IMAGE]],
  deleteImplementation: () => Promise<'deleted' | 'missing'> = () => Promise.resolve('deleted'),
) {
  const findMany = vi.fn();

  for (const result of findResults) {
    findMany.mockResolvedValueOnce(result);
  }

  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const leadUpdate = vi.fn();
  const analysisUpdate = vi.fn();
  const priceUpdate = vi.fn();
  const remove = vi.fn(deleteImplementation);
  const prisma = {
    leadImage: { findMany, updateMany },
    lead: { update: leadUpdate },
    aiAnalysis: { update: analysisUpdate },
    pricingRule: { update: priceUpdate },
  } as unknown as PrismaService;
  const storage = { delete: remove } as unknown as StorageService;

  return {
    service: new LeadImageRetentionService(prisma, storage),
    findMany,
    updateMany,
    leadUpdate,
    analysisUpdate,
    priceUpdate,
    remove,
  };
}

describe('LeadImageRetentionService', () => {
  it.each(['deleted', 'missing'] as const)(
    'marks an expired image deleted when storage reports %s',
    async (deleteResult) => {
      const fixture = createFixture([[IMAGE]], () => Promise.resolve(deleteResult));

      await expect(fixture.service.cleanupExpiredImages(NOW)).resolves.toEqual({
        found: 1,
        completed: 1,
        failed: 0,
      });
      expect(fixture.remove).toHaveBeenCalledWith(IMAGE.storagePath);
      expect(fixture.updateMany).toHaveBeenCalledWith({
        where: { id: IMAGE.id, deletedAt: null },
        data: { deletedAt: NOW },
      });
    },
  );

  it('is idempotent when the next query no longer returns the processed image', async () => {
    const fixture = createFixture([[IMAGE], []]);

    await fixture.service.cleanupExpiredImages(NOW);
    await expect(fixture.service.cleanupExpiredImages(NOW)).resolves.toEqual({
      found: 0,
      completed: 0,
      failed: 0,
    });
    expect(fixture.remove).toHaveBeenCalledOnce();
    expect(fixture.updateMany).toHaveBeenCalledOnce();
  });

  it('leaves deletedAt untouched after a temporary delete failure', async () => {
    const fixture = createFixture([[IMAGE]], () => Promise.reject(new Error('temporary')));

    await expect(fixture.service.cleanupExpiredImages(NOW)).resolves.toEqual({
      found: 1,
      completed: 0,
      failed: 1,
    });
    expect(fixture.updateMany).not.toHaveBeenCalled();
  });

  it('never changes the Lead, AiAnalysis, price, or other customer history', async () => {
    const fixture = createFixture([[IMAGE]]);

    await fixture.service.cleanupExpiredImages(NOW);

    expect(fixture.leadUpdate).not.toHaveBeenCalled();
    expect(fixture.analysisUpdate).not.toHaveBeenCalled();
    expect(fixture.priceUpdate).not.toHaveBeenCalled();
  });
});

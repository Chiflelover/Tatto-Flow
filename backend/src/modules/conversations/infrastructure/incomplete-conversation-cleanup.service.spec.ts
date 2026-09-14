import { ConversationStatus, LeadStatus } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { StorageService } from '../../storage/storage.service.js';
import { IncompleteConversationCleanupService } from './incomplete-conversation-cleanup.service.js';

const CONVERSATION_ID = 'a459f257-b03c-48f4-9091-2dc37871ef81';
const LEAD_ID = '290f2044-e63c-4e49-8847-067cd62426e4';

function createService(lead: object | null) {
  const findUnique = vi.fn().mockResolvedValue(lead);
  const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
  const deleteObject = vi.fn().mockResolvedValue('deleted');
  const service = new IncompleteConversationCleanupService(
    { lead: { findUnique, deleteMany } } as unknown as PrismaService,
    { delete: deleteObject } as unknown as StorageService,
  );

  return { service, findUnique, deleteMany, deleteObject };
}

describe('IncompleteConversationCleanupService', () => {
  it('deletes only the ANALYZING lead and its stored draft images', async () => {
    const paths = [
      `leads/${LEAD_ID}/08b0a828-43ee-473a-b0d4-cb6bf17984c1.png`,
      `leads/${LEAD_ID}/58e2839c-5518-403c-8e75-c9a927c2bd77.webp`,
    ];
    const fixture = createService({
      id: LEAD_ID,
      status: LeadStatus.ANALYZING,
      images: paths.map((storagePath) => ({ storagePath })),
    });

    await fixture.service.deleteForConversation(CONVERSATION_ID);

    expect(fixture.deleteObject).toHaveBeenCalledTimes(2);
    expect(fixture.deleteObject).toHaveBeenNthCalledWith(1, paths[0]);
    expect(fixture.deleteObject).toHaveBeenNthCalledWith(2, paths[1]);
    expect(fixture.deleteMany).toHaveBeenCalledWith({
      where: {
        id: LEAD_ID,
        status: LeadStatus.ANALYZING,
        conversation: { status: ConversationStatus.ABANDONED },
      },
    });
  });

  it.each([
    ['no lead', null],
    [
      'a complete lead',
      {
        id: LEAD_ID,
        status: LeadStatus.VERIFIED,
        images: [{ storagePath: `leads/${LEAD_ID}/complete.png` }],
      },
    ],
  ])('preserves %s and all complete history', async (_case, lead) => {
    const fixture = createService(lead);

    await fixture.service.deleteForConversation(CONVERSATION_ID);

    expect(fixture.deleteObject).not.toHaveBeenCalled();
    expect(fixture.deleteMany).not.toHaveBeenCalled();
  });
});

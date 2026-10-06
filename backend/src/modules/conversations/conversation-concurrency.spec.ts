const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';
import {
  ConversationState,
  ConversationStatus,
  Prisma,
  type Conversation,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { ConversationAbandonmentService } from './conversation-abandonment.service.js';
import { ConversationsService } from './conversations.service.js';

const CUSTOMER_A = '24d0e8b1-4dd8-4231-8b91-f52734d6bf5e';
const CONVERSATION_A = 'a459f257-b03c-48f4-9091-2dc37871ef81';

function makeConversation(id: string, customerId: string): Conversation {
  const now = new Date('2026-09-14T12:00:00.000Z');

  return {
    id,
    accountId: ACCOUNT_ID,
    v2AnalysisClaimId: null,
    v2AnalysisLeaseUntil: null,
    firstTattoo: null,
    sameSizeAsReference: null,
    targetSizeCm: null,
    colorDeclaration: null,
    customerId,
    currentState: ConversationState.ASK_FIRST_TATTOO,
    status: ConversationStatus.ACTIVE,
    bodyPart: null,
    lastActivityAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

describe('conversation concurrency', () => {
  it('recovers the active conversation when concurrent creation hits the unique index', async () => {
    const activeConversation = makeConversation(CONVERSATION_A, CUSTOMER_A);
    const conflict = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '7.10.0',
    });
    const prisma = {
      conversation: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(activeConversation),
      },
      $transaction: vi.fn().mockRejectedValue(conflict),
    } as unknown as PrismaService;
    const service = new ConversationsService(prisma, {
      abandonInactiveForCustomer: vi.fn().mockResolvedValue(0),
    } as unknown as ConversationAbandonmentService);

    await expect(service.getOrCreateActive(ACCOUNT_ID, CUSTOMER_A)).resolves.toEqual({
      conversation: activeConversation,
      created: false,
    });
  });
});

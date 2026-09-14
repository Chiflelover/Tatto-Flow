import {
  ConversationState,
  ConversationStatus,
  Prisma,
  TattooSize,
  type Conversation,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { ConversationAbandonmentService } from './conversation-abandonment.service.js';
import { ConversationsService, type ConversationUpdate } from './conversations.service.js';
import type { TemporaryImageStorage } from './ports/temporary-image-storage.port.js';

const CUSTOMER_A = '24d0e8b1-4dd8-4231-8b91-f52734d6bf5e';
const CUSTOMER_B = 'b1988d82-056f-4510-9259-0d09bb096923';
const CONVERSATION_A = 'a459f257-b03c-48f4-9091-2dc37871ef81';
const CONVERSATION_B = 'a12936c1-ab59-45a8-9137-cbbd6c128f2c';

function makeConversation(id: string, customerId: string): Conversation {
  const now = new Date('2026-09-14T12:00:00.000Z');

  return {
    id,
    customerId,
    currentState: ConversationState.ASK_SIZE,
    status: ConversationStatus.ACTIVE,
    selectedSize: null,
    selectedDetail: null,
    bodyPart: null,
    lastActivityAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

function transitionFixture(initialConversations: Conversation[]) {
  const conversations = new Map(
    initialConversations.map((conversation) => [conversation.id, conversation]),
  );
  const updateMany = vi.fn(
    (arguments_: {
      where: { id: string; currentState: ConversationState; status: ConversationStatus };
      data: ConversationUpdate & { lastActivityAt: Date };
    }) => {
      const current = conversations.get(arguments_.where.id);

      if (
        !current ||
        current.currentState !== arguments_.where.currentState ||
        current.status !== arguments_.where.status
      ) {
        return Promise.resolve({ count: 0 });
      }

      conversations.set(current.id, { ...current, ...arguments_.data, updatedAt: new Date() });
      return Promise.resolve({ count: 1 });
    },
  );
  const findUniqueOrThrow = vi.fn(({ where }: { where: { id: string } }) => {
    const conversation = conversations.get(where.id);

    if (!conversation) {
      return Promise.reject(new Error('conversation missing'));
    }

    return Promise.resolve(conversation);
  });
  const prisma = {
    conversation: { updateMany, findUniqueOrThrow },
  } as unknown as PrismaService;
  const service = new ConversationsService(
    prisma,
    {} as ConversationAbandonmentService,
    {} as TemporaryImageStorage,
  );

  return { conversations, service };
}

describe('conversation concurrency', () => {
  it('allows only one of two rapid messages to advance the same state', async () => {
    const fixture = transitionFixture([makeConversation(CONVERSATION_A, CUSTOMER_A)]);

    const results = await Promise.all([
      fixture.service.applyTransition(CONVERSATION_A, ConversationState.ASK_SIZE, {
        selectedSize: TattooSize.SMALL,
        currentState: ConversationState.ASK_DETAIL,
      }),
      fixture.service.applyTransition(CONVERSATION_A, ConversationState.ASK_SIZE, {
        selectedSize: TattooSize.LARGE,
        currentState: ConversationState.ASK_DETAIL,
      }),
    ]);

    expect(results.filter(({ applied }) => applied)).toHaveLength(1);
    expect(fixture.conversations.get(CONVERSATION_A)).toMatchObject({
      currentState: ConversationState.ASK_DETAIL,
      selectedSize: TattooSize.SMALL,
    });
  });

  it('keeps simultaneous transitions from different customers isolated', async () => {
    const fixture = transitionFixture([
      makeConversation(CONVERSATION_A, CUSTOMER_A),
      makeConversation(CONVERSATION_B, CUSTOMER_B),
    ]);

    const results = await Promise.all([
      fixture.service.applyTransition(CONVERSATION_A, ConversationState.ASK_SIZE, {
        selectedSize: TattooSize.SMALL,
        currentState: ConversationState.ASK_DETAIL,
      }),
      fixture.service.applyTransition(CONVERSATION_B, ConversationState.ASK_SIZE, {
        selectedSize: TattooSize.LARGE,
        currentState: ConversationState.ASK_DETAIL,
      }),
    ]);

    expect(results.every(({ applied }) => applied)).toBe(true);
    expect(fixture.conversations.get(CONVERSATION_A)?.selectedSize).toBe(TattooSize.SMALL);
    expect(fixture.conversations.get(CONVERSATION_B)?.selectedSize).toBe(TattooSize.LARGE);
  });

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
    const service = new ConversationsService(
      prisma,
      {
        abandonInactiveForCustomer: vi.fn().mockResolvedValue(0),
      } as unknown as ConversationAbandonmentService,
      { deleteForConversation: vi.fn() },
    );

    await expect(service.getOrCreateActive(CUSTOMER_A)).resolves.toEqual({
      conversation: activeConversation,
      created: false,
    });
  });
});

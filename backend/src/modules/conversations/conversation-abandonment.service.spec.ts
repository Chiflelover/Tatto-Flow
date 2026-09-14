import { ConversationStatus } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { CONVERSATION_ABANDONMENT_TIMEOUT_MS } from './conversation-abandonment.constants.js';
import { ConversationAbandonmentService } from './conversation-abandonment.service.js';

interface StoredConversation {
  id: string;
  customerId: string;
  status: ConversationStatus;
  lastActivityAt: Date;
}

interface UpdateManyArguments {
  where: {
    customerId?: string;
    status: ConversationStatus;
    lastActivityAt: { lte: Date };
  };
  data: { status: ConversationStatus };
}

const NOW = new Date('2026-09-14T20:00:00.000Z');

function createFixture(initialConversations: StoredConversation[]) {
  const conversations = structuredClone(initialConversations);
  const updateMany = vi.fn<(arguments_: UpdateManyArguments) => Promise<{ count: number }>>(
    (arguments_) => {
      let count = 0;

      for (const conversation of conversations) {
        const matchesCustomer =
          arguments_.where.customerId === undefined ||
          conversation.customerId === arguments_.where.customerId;
        const matchesStatus = conversation.status === arguments_.where.status;
        const isInactive =
          conversation.lastActivityAt.getTime() <= arguments_.where.lastActivityAt.lte.getTime();

        if (matchesCustomer && matchesStatus && isInactive) {
          conversation.status = arguments_.data.status;
          count += 1;
        }
      }

      return Promise.resolve({ count });
    },
  );
  const prisma = { conversation: { updateMany } } as unknown as PrismaService;

  return {
    conversations,
    service: new ConversationAbandonmentService(prisma),
    updateMany,
  };
}

function inactiveSince(milliseconds: number): Date {
  return new Date(NOW.getTime() - milliseconds);
}

describe('ConversationAbandonmentService', () => {
  it('keeps an active conversation with less than two hours of inactivity active', async () => {
    const { conversations, service } = createFixture([
      {
        id: 'recent',
        customerId: 'customer-a',
        status: ConversationStatus.ACTIVE,
        lastActivityAt: inactiveSince(CONVERSATION_ABANDONMENT_TIMEOUT_MS - 1),
      },
    ]);

    const count = await service.abandonInactive(NOW);

    expect(count).toBe(0);
    expect(conversations[0]?.status).toBe(ConversationStatus.ACTIVE);
  });

  it('abandons active conversations with exactly two hours or more of inactivity', async () => {
    const { conversations, service } = createFixture([
      {
        id: 'exact-cutoff',
        customerId: 'customer-a',
        status: ConversationStatus.ACTIVE,
        lastActivityAt: inactiveSince(CONVERSATION_ABANDONMENT_TIMEOUT_MS),
      },
      {
        id: 'older-than-cutoff',
        customerId: 'customer-b',
        status: ConversationStatus.ACTIVE,
        lastActivityAt: inactiveSince(CONVERSATION_ABANDONMENT_TIMEOUT_MS + 1),
      },
    ]);

    const count = await service.abandonInactive(NOW);

    expect(count).toBe(2);
    expect(conversations.every(({ status }) => status === ConversationStatus.ABANDONED)).toBe(true);
  });

  it('never abandons a completed conversation', async () => {
    const { conversations, service } = createFixture([
      {
        id: 'completed',
        customerId: 'customer-a',
        status: ConversationStatus.COMPLETED,
        lastActivityAt: inactiveSince(CONVERSATION_ABANDONMENT_TIMEOUT_MS * 2),
      },
    ]);

    const count = await service.abandonInactive(NOW);

    expect(count).toBe(0);
    expect(conversations[0]?.status).toBe(ConversationStatus.COMPLETED);
  });

  it('does not modify a conversation that is already abandoned', async () => {
    const { conversations, service } = createFixture([
      {
        id: 'already-abandoned',
        customerId: 'customer-a',
        status: ConversationStatus.ABANDONED,
        lastActivityAt: inactiveSince(CONVERSATION_ABANDONMENT_TIMEOUT_MS * 2),
      },
    ]);

    const count = await service.abandonInactive(NOW);

    expect(count).toBe(0);
    expect(conversations[0]?.status).toBe(ConversationStatus.ABANDONED);
  });

  it('limits customer-scoped abandonment to the requested customer', async () => {
    const { conversations, service, updateMany } = createFixture([
      {
        id: 'customer-a-conversation',
        customerId: 'customer-a',
        status: ConversationStatus.ACTIVE,
        lastActivityAt: inactiveSince(CONVERSATION_ABANDONMENT_TIMEOUT_MS),
      },
      {
        id: 'customer-b-conversation',
        customerId: 'customer-b',
        status: ConversationStatus.ACTIVE,
        lastActivityAt: inactiveSince(CONVERSATION_ABANDONMENT_TIMEOUT_MS),
      },
    ]);

    const count = await service.abandonInactiveForCustomer('customer-a', NOW);

    expect(count).toBe(1);
    expect(conversations[0]?.status).toBe(ConversationStatus.ABANDONED);
    expect(conversations[1]?.status).toBe(ConversationStatus.ACTIVE);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        customerId: 'customer-a',
        status: ConversationStatus.ACTIVE,
        lastActivityAt: {
          lte: new Date(NOW.getTime() - CONVERSATION_ABANDONMENT_TIMEOUT_MS),
        },
      },
      data: { status: ConversationStatus.ABANDONED },
    });
  });

  it('does not abandon activity updated just before the job update', async () => {
    const { conversations, service } = createFixture([
      {
        id: 'updated-before-job',
        customerId: 'customer-a',
        status: ConversationStatus.ACTIVE,
        lastActivityAt: inactiveSince(CONVERSATION_ABANDONMENT_TIMEOUT_MS),
      },
    ]);
    conversations[0].lastActivityAt = new Date(
      NOW.getTime() - CONVERSATION_ABANDONMENT_TIMEOUT_MS + 1,
    );

    const count = await service.abandonInactive(NOW);

    expect(count).toBe(0);
    expect(conversations[0]?.status).toBe(ConversationStatus.ACTIVE);
  });

  it('pauses the inactivity clock overnight and preserves the conversation next morning', async () => {
    const nextMorningAt0630 = new Date('2026-09-15T11:30:00.000Z');
    const { conversations, service } = createFixture([
      {
        id: 'paused-overnight',
        customerId: 'customer-a',
        status: ConversationStatus.ACTIVE,
        lastActivityAt: new Date('2026-09-15T02:30:00.000Z'),
      },
    ]);

    const count = await service.abandonInactive(nextMorningAt0630);

    expect(count).toBe(0);
    expect(conversations[0]?.status).toBe(ConversationStatus.ACTIVE);
  });

  it('abandons at two accumulated open hours even when a night occurred between them', async () => {
    const nextMorningAt0630 = new Date('2026-09-15T11:30:00.000Z');
    const { conversations, service } = createFixture([
      {
        id: 'expired-across-night',
        customerId: 'customer-a',
        status: ConversationStatus.ACTIVE,
        lastActivityAt: new Date('2026-09-15T01:30:00.000Z'),
      },
    ]);

    const count = await service.abandonInactive(nextMorningAt0630);

    expect(count).toBe(1);
    expect(conversations[0]?.status).toBe(ConversationStatus.ABANDONED);
  });
});

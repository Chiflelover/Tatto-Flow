const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';
import {
  ConversationState,
  ConversationStatus,
  Prisma,
  type Conversation,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { CONVERSATION_ABANDONMENT_TIMEOUT_MS } from './conversation-abandonment.constants.js';
import { ConversationAbandonmentService } from './conversation-abandonment.service.js';

const NOW = new Date('2026-09-14T20:00:00.000Z');
const CUSTOMER_A = '24d0e8b1-4dd8-4231-8b91-f52734d6bf5e';

function inactiveSince(milliseconds: number): Date {
  return new Date(NOW.getTime() - milliseconds);
}

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  const createdAt = new Date('2026-09-14T12:00:00.000Z');

  return {
    id: crypto.randomUUID(),
    accountId: ACCOUNT_ID,
    v2AnalysisClaimId: null,
    v2AnalysisLeaseUntil: null,
    firstTattoo: null,
    sameSizeAsReference: null,
    targetSizeCm: null,
    colorDeclaration: null,
    customerId: CUSTOMER_A,
    currentState: ConversationState.ASK_FIRST_TATTOO,
    status: ConversationStatus.ACTIVE,
    bodyPart: null,
    lastActivityAt: inactiveSince(CONVERSATION_ABANDONMENT_TIMEOUT_MS),
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function createFixture(initialConversations: Conversation[]) {
  const conversations = structuredClone(initialConversations);
  const leads = new Map<string, Record<string, unknown>>();
  const findMany = vi.fn(
    ({
      where,
    }: {
      where: { customerId?: string; status: ConversationStatus; lastActivityAt: { lte: Date } };
    }) =>
      Promise.resolve(
        conversations
          .filter(
            (conversation) =>
              (!where.customerId || conversation.customerId === where.customerId) &&
              conversation.status === where.status &&
              conversation.lastActivityAt <= where.lastActivityAt.lte,
          )
          .map((conversation) => ({ ...conversation, lead: null })),
      ),
  );
  const updateMany = vi.fn(
    ({
      where,
      data,
    }: {
      where: { id: string; status: ConversationStatus; lastActivityAt: { lte: Date } };
      data: { status: ConversationStatus };
    }) => {
      const conversation = conversations.find(
        (candidate) =>
          candidate.id === where.id &&
          candidate.status === where.status &&
          candidate.lastActivityAt <= where.lastActivityAt.lte,
      );

      if (!conversation) return Promise.resolve({ count: 0 });
      conversation.status = data.status;
      return Promise.resolve({ count: 1 });
    },
  );
  const upsertLead = vi.fn(({ where, create, update }: Prisma.LeadUpsertArgs) => {
    const existing = [...leads.values()].find(
      (lead) => lead.conversationId === where.conversationId,
    );
    const lead = existing
      ? { ...existing, ...update }
      : {
          id: crypto.randomUUID(),
          ...create,
          aiAnalysis: null,
          images: [],
        };

    if (typeof lead.id !== 'string') {
      throw new Error('The fixture requires a scalar lead ID.');
    }

    leads.set(lead.id, lead);
    return Promise.resolve(lead);
  });
  const transaction = {
    conversation: { updateMany },
    lead: { upsert: upsertLead },
  };
  const prisma = {
    conversation: { findMany },
    $transaction: vi.fn((callback: (client: typeof transaction) => Promise<boolean>) =>
      callback(transaction),
    ),
  } as unknown as PrismaService;
  const service = new ConversationAbandonmentService(prisma);

  return { conversations, leads, service, upsertLead };
}

describe('ConversationAbandonmentService', () => {
  it('keeps an active incomplete conversation under two hours unchanged', async () => {
    const conversation = makeConversation({
      lastActivityAt: inactiveSince(CONVERSATION_ABANDONMENT_TIMEOUT_MS - 1),
    });
    const fixture = createFixture([conversation]);

    await expect(fixture.service.abandonInactive(NOW)).resolves.toBe(0);
    expect(fixture.conversations[0]?.status).toBe(ConversationStatus.ACTIVE);
    expect(fixture.upsertLead).not.toHaveBeenCalled();
  });

  it('never modifies completed or already abandoned conversations', async () => {
    const fixture = createFixture([
      makeConversation({ status: ConversationStatus.COMPLETED }),
      makeConversation({ status: ConversationStatus.ABANDONED }),
    ]);

    await expect(fixture.service.abandonInactive(NOW)).resolves.toBe(0);
    expect(fixture.upsertLead).not.toHaveBeenCalled();
  });

  it('limits abandonment to the requested customer', async () => {
    const other = makeConversation({ customerId: crypto.randomUUID() });
    const fixture = createFixture([makeConversation(), other]);

    await expect(fixture.service.abandonInactiveForCustomer(CUSTOMER_A, NOW)).resolves.toBe(1);
    expect(fixture.conversations[0]?.status).toBe(ConversationStatus.ABANDONED);
    expect(fixture.conversations[1]?.status).toBe(ConversationStatus.ACTIVE);
  });

  it('pauses the inactivity clock overnight and continues the next morning', async () => {
    const nextMorningAt0630 = new Date('2026-09-15T11:30:00.000Z');
    const fixture = createFixture([
      makeConversation({ lastActivityAt: new Date('2026-09-15T02:30:00.000Z') }),
    ]);

    await expect(fixture.service.abandonInactive(nextMorningAt0630)).resolves.toBe(0);
    expect(fixture.conversations[0]?.status).toBe(ConversationStatus.ACTIVE);
  });

  it('abandons after two accumulated open hours across the night', async () => {
    const nextMorningAt0630 = new Date('2026-09-15T11:30:00.000Z');
    const fixture = createFixture([
      makeConversation({ lastActivityAt: new Date('2026-09-15T01:30:00.000Z') }),
    ]);

    await expect(fixture.service.abandonInactive(nextMorningAt0630)).resolves.toBe(1);
    expect(fixture.conversations[0]?.status).toBe(ConversationStatus.ABANDONED);
  });
});

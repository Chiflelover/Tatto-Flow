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
const ACCOUNT_B = '00000000-0000-4000-8000-000000000002';
const CUSTOMER_B = 'd1112d93-4777-4819-9c21-9526d8131ac4';

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
      where: {
        id: string;
        accountId: string;
        customerId: string;
        status: ConversationStatus;
        lastActivityAt: { lte: Date };
      };
      data: { status: ConversationStatus };
    }) => {
      const conversation = conversations.find(
        (candidate) =>
          candidate.id === where.id &&
          candidate.accountId === where.accountId &&
          candidate.customerId === where.customerId &&
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

  return { conversations, leads, service, upsertLead, findMany, updateMany };
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

  it.each([CONVERSATION_ABANDONMENT_TIMEOUT_MS, CONVERSATION_ABANDONMENT_TIMEOUT_MS + 1])(
    'abandons an incomplete conversation after %s milliseconds of real inactivity',
    async (inactivityMs) => {
      const fixture = createFixture([
        makeConversation({ lastActivityAt: inactiveSince(inactivityMs) }),
      ]);

      await expect(fixture.service.abandonInactive(NOW)).resolves.toBe(1);
      expect(fixture.conversations[0]?.status).toBe(ConversationStatus.ABANDONED);
      expect(fixture.leads.size).toBe(1);
    },
  );

  it('limits abandonment to the requested customer', async () => {
    const other = makeConversation({ customerId: crypto.randomUUID() });
    const anotherAccount = makeConversation({ accountId: ACCOUNT_B, customerId: CUSTOMER_B });
    const fixture = createFixture([makeConversation(), other, anotherAccount]);

    await expect(fixture.service.abandonInactiveForCustomer(CUSTOMER_A, NOW)).resolves.toBe(1);
    expect(fixture.conversations[0]?.status).toBe(ConversationStatus.ABANDONED);
    expect(fixture.conversations[1]?.status).toBe(ConversationStatus.ACTIVE);
    expect(fixture.conversations[2]?.status).toBe(ConversationStatus.ACTIVE);
    expect([...fixture.leads.values()]).toEqual([
      expect.objectContaining({ accountId: ACCOUNT_ID, customerId: CUSTOMER_A }),
    ]);
  });

  it('abandons at 23:30 a conversation last active at 21:30 in Lima', async () => {
    const fixture = createFixture([
      makeConversation({ lastActivityAt: new Date('2026-09-15T02:30:00.000Z') }),
    ]);

    await expect(
      fixture.service.abandonInactive(new Date('2026-09-15T04:30:00.000Z')),
    ).resolves.toBe(1);
    expect(fixture.conversations[0]?.status).toBe(ConversationStatus.ABANDONED);
  });

  it('counts the whole night instead of preserving the previous evening intake', async () => {
    const nextMorningAt0630 = new Date('2026-09-15T11:30:00.000Z');
    const fixture = createFixture([
      makeConversation({ lastActivityAt: new Date('2026-09-15T02:30:00.000Z') }),
    ]);

    await expect(fixture.service.abandonInactive(nextMorningAt0630)).resolves.toBe(1);
    expect(fixture.conversations[0]?.status).toBe(ConversationStatus.ABANDONED);
  });

  it('sweeps expired conversations across accounts without mixing their history', async () => {
    const fixture = createFixture([
      makeConversation({ targetSizeCm: 8, bodyPart: 'Brazo' }),
      makeConversation({
        accountId: ACCOUNT_B,
        customerId: CUSTOMER_B,
        targetSizeCm: 20,
        bodyPart: 'Pierna',
      }),
      makeConversation({ lastActivityAt: NOW, customerId: crypto.randomUUID() }),
    ]);

    await expect(fixture.service.abandonInactive(NOW)).resolves.toBe(2);
    expect(fixture.conversations[0]?.status).toBe(ConversationStatus.ABANDONED);
    expect(fixture.conversations[1]?.status).toBe(ConversationStatus.ABANDONED);
    expect(fixture.conversations[2]?.status).toBe(ConversationStatus.ACTIVE);
    expect([...fixture.leads.values()]).toEqual([
      expect.objectContaining({
        accountId: ACCOUNT_ID,
        customerId: CUSTOMER_A,
        conversationId: fixture.conversations[0]?.id,
        targetSizeCm: 8,
        bodyPart: 'Brazo',
      }),
      expect.objectContaining({
        accountId: ACCOUNT_B,
        customerId: CUSTOMER_B,
        conversationId: fixture.conversations[1]?.id,
        targetSizeCm: 20,
        bodyPart: 'Pierna',
      }),
    ]);
  });

  it('does not abandon a conversation that becomes active after selecting candidates', async () => {
    const fixture = createFixture([makeConversation()]);
    fixture.findMany.mockImplementationOnce(() => {
      const candidate = { ...fixture.conversations[0], lead: null };
      fixture.conversations[0].lastActivityAt = NOW;
      return Promise.resolve([candidate]);
    });

    await expect(fixture.service.abandonInactive(NOW)).resolves.toBe(0);
    expect(fixture.conversations[0]?.status).toBe(ConversationStatus.ACTIVE);
    expect(fixture.upsertLead).not.toHaveBeenCalled();
  });

  it('is idempotent when the periodic sweep runs repeatedly', async () => {
    const fixture = createFixture([makeConversation()]);

    await expect(fixture.service.abandonInactive(NOW)).resolves.toBe(1);
    const history = structuredClone([...fixture.leads.values()]);
    await expect(fixture.service.abandonInactive(NOW)).resolves.toBe(0);
    expect([...fixture.leads.values()]).toEqual(history);
    expect(fixture.upsertLead).toHaveBeenCalledOnce();
  });
});

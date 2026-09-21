import {
  ConversationState,
  ConversationStatus,
  LeadStatus,
  type Conversation,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { ConversationAbandonmentService } from './conversation-abandonment.service.js';
import { ConversationsService, type ActiveConversationResult } from './conversations.service.js';

interface DeleteManyArguments {
  where: {
    id: { in: string[] };
    customerId: string;
    status: ConversationStatus;
    lead: null;
  };
}

interface CreateArguments {
  data: {
    customerId: string;
    currentState: ConversationState;
    status: ConversationStatus;
    lastActivityAt: Date;
  };
}

interface FindFirstArguments {
  where: {
    customerId: string;
    status: ConversationStatus;
    currentState?: ConversationState;
    lead?: { is: { status: { not: LeadStatus } } };
  };
}

interface TransactionMock {
  conversation: {
    deleteMany: (arguments_: DeleteManyArguments) => Promise<{ count: number }>;
    findFirst: (arguments_: FindFirstArguments) => Promise<Conversation | null>;
    create: (arguments_: CreateArguments) => Promise<Conversation>;
  };
}

const CUSTOMER_ID = '24d0e8b1-4dd8-4231-8b91-f52734d6bf5e';
const ABANDONED_CONVERSATION_ID = 'a459f257-b03c-48f4-9091-2dc37871ef81';

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  const now = new Date('2026-09-14T12:00:00.000Z');

  return {
    id: ABANDONED_CONVERSATION_ID,
    customerId: CUSTOMER_ID,
    currentState: ConversationState.ASK_BODY_PART,
    status: ConversationStatus.ABANDONED,
    selectedSize: 'MEDIUM',
    selectedDetail: 'LIGHT',
    bodyPart: null,
    lastActivityAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createFixture() {
  const conversations = [makeConversation()];
  const leads = [{ id: 'historical-lead', customerId: CUSTOMER_ID }];
  const leadStatusByConversation = new Map<string, LeadStatus>();
  const deleteCustomer = vi.fn();
  const deleteLead = vi.fn();
  const findMany = vi.fn(() =>
    Promise.resolve(
      conversations
        .filter(
          ({ customerId, status }) =>
            customerId === CUSTOMER_ID && status === ConversationStatus.ABANDONED,
        )
        .map(({ id }) => ({ id })),
    ),
  );
  const deleteMany = vi.fn<(arguments_: DeleteManyArguments) => Promise<{ count: number }>>(
    ({ where }) => {
      const previousLength = conversations.length;
      const remaining = conversations.filter(
        ({ id, customerId, status }) =>
          !(where.id.in.includes(id) && customerId === where.customerId && status === where.status),
      );
      conversations.splice(0, conversations.length, ...remaining);

      return Promise.resolve({ count: previousLength - remaining.length });
    },
  );
  const findFirst = vi.fn((arguments_: FindFirstArguments) =>
    Promise.resolve(
      conversations.find(
        ({ id, customerId, status, currentState }) =>
          customerId === arguments_.where.customerId &&
          status === arguments_.where.status &&
          (!arguments_.where.currentState || currentState === arguments_.where.currentState) &&
          (!arguments_.where.lead ||
            (leadStatusByConversation.has(id) &&
              leadStatusByConversation.get(id) !== arguments_.where.lead.is.status.not)),
      ) ?? null,
    ),
  );
  const create = vi.fn<(arguments_: CreateArguments) => Promise<Conversation>>(({ data }) => {
    const conversation = makeConversation({
      id: 'new-conversation',
      customerId: data.customerId,
      currentState: data.currentState,
      status: data.status,
      selectedSize: null,
      selectedDetail: null,
      bodyPart: null,
      lastActivityAt: data.lastActivityAt,
      createdAt: data.lastActivityAt,
      updatedAt: data.lastActivityAt,
    });
    conversations.push(conversation);

    return Promise.resolve(conversation);
  });
  const transaction: TransactionMock = {
    conversation: { deleteMany, findFirst, create },
  };
  const runTransaction = vi.fn(
    (callback: (transaction_: TransactionMock) => Promise<ActiveConversationResult>) =>
      callback(transaction),
  );
  const prisma = {
    conversation: { findMany },
    customer: { delete: deleteCustomer },
    lead: { delete: deleteLead },
    $transaction: runTransaction,
  } as unknown as PrismaService;
  const abandonInactiveForCustomer = vi.fn<
    ConversationAbandonmentService['abandonInactiveForCustomer']
  >((customerId, now = new Date()) => {
    const cutoff = now.getTime() - 2 * 60 * 60 * 1_000;
    let abandoned = 0;

    for (const conversation of conversations) {
      if (
        conversation.customerId === customerId &&
        conversation.status === ConversationStatus.ACTIVE &&
        conversation.lastActivityAt.getTime() <= cutoff
      ) {
        conversation.status = ConversationStatus.ABANDONED;
        abandoned += 1;
      }
    }

    return Promise.resolve(abandoned);
  });
  const abandonmentService = {
    abandonInactiveForCustomer,
  } as unknown as ConversationAbandonmentService;
  const service = new ConversationsService(prisma, abandonmentService);

  return {
    conversations,
    leads,
    leadStatusByConversation,
    service,
    findMany,
    deleteMany,
    create,
    findFirst,
    deleteCustomer,
    deleteLead,
  };
}

describe('ConversationsService abandoned conversation cleanup', () => {
  it('continues the same incomplete conversation when inactivity is under two hours', async () => {
    const fixture = createFixture();
    const active = makeConversation({
      status: ConversationStatus.ACTIVE,
      currentState: ConversationState.ASK_DETAIL,
      selectedSize: 'SMALL',
      selectedDetail: null,
      lastActivityAt: new Date(Date.now() - 60 * 60 * 1_000),
    });
    fixture.conversations.splice(0, fixture.conversations.length, active);

    const result = await fixture.service.getOrCreateActive(CUSTOMER_ID);

    expect(result).toEqual({ conversation: active, created: false });
    expect(fixture.create).not.toHaveBeenCalled();
  });

  it('restarts from zero on the next interaction after two hours of inactivity', async () => {
    const fixture = createFixture();
    const expired = makeConversation({
      status: ConversationStatus.ACTIVE,
      currentState: ConversationState.ASK_DETAIL,
      selectedSize: 'SMALL',
      selectedDetail: null,
      lastActivityAt: new Date(Date.now() - 2 * 60 * 60 * 1_000),
    });
    fixture.conversations.splice(0, fixture.conversations.length, expired);

    const result = await fixture.service.getOrCreateActive(CUSTOMER_ID);

    expect(result.created).toBe(true);
    expect(result.conversation.currentState).toBe(ConversationState.START);
    expect(fixture.conversations).toContainEqual(expired);
    expect(expired.status).toBe(ConversationStatus.ABANDONED);
  });

  it('preserves the abandoned conversation and creates a fresh START conversation', async () => {
    const fixture = createFixture();

    const result = await fixture.service.getOrCreateActive(CUSTOMER_ID);

    expect(result.created).toBe(true);
    expect(result.conversation.id).toBe('new-conversation');
    expect(result.conversation.currentState).toBe(ConversationState.START);
    expect(result.conversation.selectedSize).toBeNull();
    expect(result.conversation.selectedDetail).toBeNull();
    expect(result.conversation.bodyPart).toBeNull();
    expect(fixture.conversations).toHaveLength(2);
    expect(fixture.conversations.map(({ id }) => id)).toEqual([
      ABANDONED_CONVERSATION_ID,
      'new-conversation',
    ]);
    expect(fixture.create).toHaveBeenCalledOnce();
  });

  it('preserves the original customer when the customer returns', async () => {
    const fixture = createFixture();

    await fixture.service.getOrCreateActive(CUSTOMER_ID);

    expect(fixture.deleteCustomer).not.toHaveBeenCalled();
    expect(fixture.findMany).not.toHaveBeenCalled();
  });

  it('preserves prior leads and never deletes the abandoned history', async () => {
    const fixture = createFixture();

    await fixture.service.getOrCreateActive(CUSTOMER_ID);

    expect(fixture.leads).toEqual([{ id: 'historical-lead', customerId: CUSTOMER_ID }]);
    expect(fixture.deleteLead).not.toHaveBeenCalled();
    expect(fixture.deleteMany).not.toHaveBeenCalled();
  });

  it('returns the handed-off conversation instead of starting another quotation', async () => {
    const fixture = createFixture();
    const handedOff = makeConversation({
      id: 'completed-conversation',
      currentState: ConversationState.HANDOFF_TO_TATTOO_ARTIST,
      status: ConversationStatus.COMPLETED,
    });
    fixture.conversations.splice(0, fixture.conversations.length, handedOff);
    fixture.leadStatusByConversation.set(handedOff.id, LeadStatus.VERIFIED);

    const result = await fixture.service.getOrCreateActive(CUSTOMER_ID);

    expect(result).toEqual({ conversation: handedOff, created: false });
    expect(fixture.create).not.toHaveBeenCalled();
    expect(fixture.findFirst).toHaveBeenCalledWith({
      where: {
        customerId: CUSTOMER_ID,
        status: ConversationStatus.COMPLETED,
        currentState: ConversationState.HANDOFF_TO_TATTOO_ARTIST,
        lead: {
          is: {
            status: { not: LeadStatus.COMPLETED },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  });

  it('creates a new quotation after the handed-off lead is marked COMPLETED', async () => {
    const fixture = createFixture();
    const handedOff = makeConversation({
      id: 'completed-conversation',
      currentState: ConversationState.HANDOFF_TO_TATTOO_ARTIST,
      status: ConversationStatus.COMPLETED,
    });
    fixture.conversations.splice(0, fixture.conversations.length, handedOff);
    fixture.leadStatusByConversation.set(handedOff.id, LeadStatus.COMPLETED);

    const result = await fixture.service.getOrCreateActive(CUSTOMER_ID);

    expect(result.created).toBe(true);
    expect(result.conversation).toMatchObject({
      id: 'new-conversation',
      currentState: ConversationState.START,
      status: ConversationStatus.ACTIVE,
      selectedSize: null,
      selectedDetail: null,
      bodyPart: null,
    });
    expect(fixture.conversations).toContainEqual(handedOff);
  });
});

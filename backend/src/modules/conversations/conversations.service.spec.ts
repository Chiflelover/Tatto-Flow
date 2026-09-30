const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';
import {
  ConversationState,
  ConversationStatus,
  FlowVersion,
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
    flowVersion: FlowVersion;
    currentState: ConversationState;
    status: ConversationStatus;
    lastActivityAt: Date;
  };
}

interface FindFirstArguments {
  where: {
    accountId: string;
    customerId: string;
    status?: ConversationStatus;
    currentState?: ConversationState;
    lead?: { is: { status: { not: LeadStatus } } };
  };
  orderBy: { createdAt?: 'desc'; updatedAt?: 'desc' };
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
    accountId: ACCOUNT_ID,
    flowVersion: 'V1',
    v2AnalysisClaimId: null,
    v2AnalysisLeaseUntil: null,
    firstTattoo: null,
    sameSizeAsReference: null,
    targetSizeCm: null,
    colorDeclaration: null,
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
      conversations
        .filter(
          ({ id, accountId, customerId, status, currentState }) =>
            accountId === arguments_.where.accountId &&
            customerId === arguments_.where.customerId &&
            (!arguments_.where.status || status === arguments_.where.status) &&
            (!arguments_.where.currentState || currentState === arguments_.where.currentState) &&
            (!arguments_.where.lead ||
              (leadStatusByConversation.has(id) &&
                leadStatusByConversation.get(id) !== arguments_.where.lead.is.status.not)),
        )
        .sort((a, b) => {
          const field = arguments_.orderBy.updatedAt ? 'updatedAt' : 'createdAt';
          return b[field].getTime() - a[field].getTime();
        })[0] ?? null,
    ),
  );
  const create = vi.fn<(arguments_: CreateArguments) => Promise<Conversation>>(({ data }) => {
    const conversation = makeConversation({
      id: 'new-conversation',
      customerId: data.customerId,
      flowVersion: data.flowVersion,
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
  it('creates V2 when requested explicitly and defaults to V1 without prior V2', async () => {
    const f = createFixture();
    const result = await f.service.getOrCreateActive(ACCOUNT_ID, CUSTOMER_ID, FlowVersion.V2);
    expect(result.conversation.flowVersion).toBe('V2');
    expect(f.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ flowVersion: 'V2' }) as unknown }),
    );
    const defaultFixture = createFixture();
    expect(
      (await defaultFixture.service.getOrCreateActive(ACCOUNT_ID, CUSTOMER_ID)).conversation
        .flowVersion,
    ).toBe('V1');
  });
  it('never changes an active V1 conversation when requesting V2 for new conversations', async () => {
    const f = createFixture();
    f.conversations[0] = makeConversation({
      status: ConversationStatus.ACTIVE,
      lastActivityAt: new Date(),
    });
    expect(
      (await f.service.getOrCreateActive(ACCOUNT_ID, CUSTOMER_ID, FlowVersion.V2)).conversation
        .flowVersion,
    ).toBe('V1');
    expect(f.create).not.toHaveBeenCalled();
  });
  it.each([ConversationStatus.ABANDONED, ConversationStatus.ACTIVE])(
    'restarts an expired V2 from %s with empty answers even when the default is V1',
    async (status) => {
      const f = createFixture();
      const old = makeConversation({
        flowVersion: FlowVersion.V2,
        status,
        currentState: ConversationState.ASK_BODY_PART,
        firstTattoo: false,
        sameSizeAsReference: false,
        targetSizeCm: 12.5,
        colorDeclaration: 'BLACK_WITH_SOME_COLOR',
        bodyPart: 'Antebrazo izquierdo',
        selectedSize: null,
        selectedDetail: null,
      });
      f.conversations.splice(0, f.conversations.length, old);

      const result = await f.service.getOrCreateActive(ACCOUNT_ID, CUSTOMER_ID);

      expect(result.created).toBe(true);
      expect(result.conversation.id).not.toBe(old.id);
      expect(result.conversation).toMatchObject({
        flowVersion: FlowVersion.V2,
        status: ConversationStatus.ACTIVE,
        currentState: ConversationState.START,
        firstTattoo: null,
        sameSizeAsReference: null,
        targetSizeCm: null,
        colorDeclaration: null,
        bodyPart: null,
        selectedSize: null,
        selectedDetail: null,
      });
      expect(old).toMatchObject({
        status: ConversationStatus.ABANDONED,
        firstTattoo: false,
        sameSizeAsReference: false,
        targetSizeCm: 12.5,
        colorDeclaration: 'BLACK_WITH_SOME_COLOR',
        bodyPart: 'Antebrazo izquierdo',
      });
      expect(await f.service.getOrCreateActive(ACCOUNT_ID, CUSTOMER_ID)).toEqual({
        conversation: result.conversation,
        created: false,
      });
      expect(f.conversations).toHaveLength(2);
      expect(f.create).toHaveBeenCalledOnce();
      expect(f.deleteMany).not.toHaveBeenCalled();
      expect(f.deleteLead).not.toHaveBeenCalled();
    },
  );
  it('does not resume an older handoff when the latest conversation is abandoned V2', async () => {
    const f = createFixture();
    const oldHandoff = makeConversation({
      id: 'older-handoff',
      status: ConversationStatus.COMPLETED,
      currentState: ConversationState.HANDOFF_TO_TATTOO_ARTIST,
      createdAt: new Date('2026-09-13T12:00:00.000Z'),
    });
    f.leadStatusByConversation.set(oldHandoff.id, LeadStatus.VERIFIED);
    f.conversations[0] = makeConversation({ flowVersion: FlowVersion.V2 });
    f.conversations.push(oldHandoff);

    const result = await f.service.getOrCreateActive(ACCOUNT_ID, CUSTOMER_ID);

    expect(result.created).toBe(true);
    expect(result.conversation.flowVersion).toBe(FlowVersion.V2);
    expect(result.conversation.currentState).toBe(ConversationState.START);
    expect(f.conversations).toContainEqual(oldHandoff);
  });
  it('uses the default for newer V1 history rather than an older abandoned V2', async () => {
    const f = createFixture();
    f.conversations[0] = makeConversation({ flowVersion: FlowVersion.V2 });
    f.conversations.push(
      makeConversation({
        id: 'newer-v1',
        createdAt: new Date('2026-09-15T12:00:00.000Z'),
      }),
    );

    const result = await f.service.getOrCreateActive(ACCOUNT_ID, CUSTOMER_ID);

    expect(result.created).toBe(true);
    expect(result.conversation.flowVersion).toBe(FlowVersion.V1);
  });
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

    const result = await fixture.service.getOrCreateActive(ACCOUNT_ID, CUSTOMER_ID);

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

    const result = await fixture.service.getOrCreateActive(ACCOUNT_ID, CUSTOMER_ID);

    expect(result.created).toBe(true);
    expect(result.conversation.currentState).toBe(ConversationState.START);
    expect(fixture.conversations).toContainEqual(expired);
    expect(expired.status).toBe(ConversationStatus.ABANDONED);
  });

  it('preserves the abandoned conversation and creates a fresh START conversation', async () => {
    const fixture = createFixture();

    const result = await fixture.service.getOrCreateActive(ACCOUNT_ID, CUSTOMER_ID);

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

    await fixture.service.getOrCreateActive(ACCOUNT_ID, CUSTOMER_ID);

    expect(fixture.deleteCustomer).not.toHaveBeenCalled();
    expect(fixture.findMany).not.toHaveBeenCalled();
  });

  it('preserves prior leads and never deletes the abandoned history', async () => {
    const fixture = createFixture();

    await fixture.service.getOrCreateActive(ACCOUNT_ID, CUSTOMER_ID);

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

    const result = await fixture.service.getOrCreateActive(ACCOUNT_ID, CUSTOMER_ID);

    expect(result).toEqual({ conversation: handedOff, created: false });
    expect(fixture.create).not.toHaveBeenCalled();
    expect(fixture.findFirst).toHaveBeenCalledWith({
      where: {
        accountId: ACCOUNT_ID,
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

    const result = await fixture.service.getOrCreateActive(ACCOUNT_ID, CUSTOMER_ID);

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

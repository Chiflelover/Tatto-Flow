import {
  ConversationState,
  ConversationStatus,
  Prisma,
  ReadinessStatus,
  TattooSize,
  type Conversation,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { LEAD_SCORING_CONFIG_V1 } from '../lead-scoring/lead-scoring.config.js';
import { LeadScoringService } from '../lead-scoring/lead-scoring.service.js';
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
    customerId: CUSTOMER_A,
    currentState: ConversationState.ASK_SIZE,
    status: ConversationStatus.ACTIVE,
    selectedSize: null,
    selectedDetail: null,
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
  const evaluations = new Map<string, Record<string, unknown>>();
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
  const upsertEvaluation = vi.fn(({ create }: Prisma.LeadEvaluationUpsertArgs) => {
    if (typeof create.leadId !== 'string') {
      throw new Error('The fixture requires a scalar leadId.');
    }

    evaluations.set(create.leadId, { ...create });
    return Promise.resolve(create);
  });
  const transaction = {
    conversation: { updateMany },
    lead: { upsert: upsertLead },
    leadEvaluation: { upsert: upsertEvaluation },
  };
  const prisma = {
    conversation: { findMany },
    $transaction: vi.fn((callback: (client: typeof transaction) => Promise<boolean>) =>
      callback(transaction),
    ),
  } as unknown as PrismaService;
  const service = new ConversationAbandonmentService(
    prisma,
    new LeadScoringService(LEAD_SCORING_CONFIG_V1),
  );

  return { conversations, evaluations, leads, service, upsertLead, upsertEvaluation };
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

  it('abandons at exactly two hours and persists a partial INCOMPLETO evaluation', async () => {
    const conversation = makeConversation({
      currentState: ConversationState.ASK_DETAIL,
      selectedSize: TattooSize.SMALL,
    });
    const fixture = createFixture([conversation]);

    await expect(fixture.service.abandonInactive(NOW)).resolves.toBe(1);
    expect(fixture.conversations[0]?.status).toBe(ConversationStatus.ABANDONED);
    expect(fixture.leads.size).toBe(1);
    const evaluation = [...fixture.evaluations.values()][0];
    expect(evaluation).toMatchObject({
      rawScore: 25,
      readinessStatus: ReadinessStatus.INCOMPLETO,
      rulesVersion: 1,
    });
    expect(evaluation?.contributions).toEqual([
      {
        ruleId: 'SIZE_PROVIDED',
        points: 25,
        reason: 'El cliente indicó el tamaño',
      },
    ]);
    expect(evaluation?.blockers).toEqual([
      {
        ruleId: 'FLOW_INCOMPLETE',
        reason: 'La cotización está incompleta o la conversación fue abandonada',
      },
    ]);
  });

  it('does not call image analysis when an abandoned lead has no image', async () => {
    const fixture = createFixture([makeConversation()]);

    await fixture.service.abandonInactive(NOW);

    expect(fixture.upsertLead).toHaveBeenCalledOnce();
    expect(fixture.upsertEvaluation).toHaveBeenCalledOnce();
    expect([...fixture.leads.values()][0]?.images).toEqual([]);
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

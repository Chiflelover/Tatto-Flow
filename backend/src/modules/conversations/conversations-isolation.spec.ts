import { ConversationStatus } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { ConversationAbandonmentService } from './conversation-abandonment.service.js';
import { ConversationsService } from './conversations.service.js';

describe('ConversationsService account isolation', () => {
  it("does not return another account's conversation for the same customer lookup", async () => {
    const accountA = '00000000-0000-4000-8000-000000000001';
    const accountB = '00000000-0000-4000-8000-000000000002';
    const customerId = '24d0e8b1-4dd8-4231-8b91-f52734d6bf5e';
    const findFirst = vi.fn(
      ({ where }: { where: { accountId: string; status: ConversationStatus } }) =>
        Promise.resolve(
          where.accountId === accountA && where.status === ConversationStatus.ACTIVE
            ? { id: 'conversation-a', accountId: accountA }
            : null,
        ),
    );
    const service = new ConversationsService(
      { conversation: { findFirst } } as unknown as PrismaService,
      {} as ConversationAbandonmentService,
    );

    expect((await service.findCurrentForCustomer(accountA, customerId))?.id).toBe('conversation-a');
    expect(await service.findCurrentForCustomer(accountB, customerId)).toBeNull();
    expect(
      findFirst.mock.calls.some(
        ([argument]) =>
          argument.where.accountId === accountB &&
          argument.where.status === ConversationStatus.ACTIVE,
      ),
    ).toBe(true);
  });
});

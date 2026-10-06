import { ConfigService } from '@nestjs/config';
import type { Conversation } from '../../generated/prisma/client.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { CustomersService } from '../customers/customers.service.js';
import { LeadImageStorageException } from '../storage/lead-image.service.js';
import { ChatbotService } from './chatbot.service.js';
import { NitaV2StateMachine } from './domain/nita-v2-state-machine.js';
import type { ChatbotConversationUpdate } from './domain/chatbot.types.js';
import { NitaBusinessHoursService } from './nita-business-hours.service.js';
import { NitaV2IntakeService } from './nita-v2-intake.service.js';
import { NitaV2AnalysisService } from './nita-v2-analysis.service.js';
import { NitaV2CompletionService } from './nita-v2-completion.service.js';
import { VISION_IMAGE } from '../../../test/fixtures/vision-v2.js';

function fixture(overrides: Partial<Conversation> = {}) {
  let conversation: Conversation = {
    id: 'conversation',
    accountId: 'account',
    customerId: 'customer',
    currentState: 'START',
    status: 'ACTIVE',
    bodyPart: null,
    firstTattoo: null,
    sameSizeAsReference: null,
    targetSizeCm: null,
    colorDeclaration: null,
    v2AnalysisClaimId: null,
    v2AnalysisLeaseUntil: null,
    lastActivityAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  const applyTransition = vi.fn(
    (_account: string, _id: string, expected: string, update: ChatbotConversationUpdate) => {
      const applied = conversation.currentState === expected;
      if (applied) conversation = { ...conversation, ...update };
      return Promise.resolve({ conversation, applied });
    },
  );
  const storeReference = vi.fn().mockImplementation(() => {
    conversation = { ...conversation, currentState: 'ASK_SAME_SIZE' };
    return Promise.resolve({ conversation, applied: true });
  });
  const process = vi.fn().mockImplementation(() => Promise.resolve(conversation));
  const prepare = vi.fn().mockImplementation(() => Promise.resolve(conversation));
  const service = new ChatbotService(
    {
      findOrCreateByPhoneNumber: vi.fn().mockResolvedValue({ id: 'customer' }),
    } as unknown as CustomersService,
    {
      getOrCreateActive: vi
        .fn()
        .mockImplementation(() => Promise.resolve({ conversation, created: false })),
    } as unknown as ConversationsService,
    new NitaV2StateMachine(),
    { isOpen: () => true } as NitaBusinessHoursService,
    new ConfigService(),
    { applyTransition, storeReference } as unknown as NitaV2IntakeService,
    { process } as unknown as NitaV2AnalysisService,
    { prepare } as unknown as NitaV2CompletionService,
  );
  return {
    service,
    applyTransition,
    storeReference,
    process,
    prepare,
    current: () => conversation,
  };
}

describe('ChatbotService current Nita', () => {
  it('starts the only intake with the first-tattoo question', async () => {
    const f = fixture();
    expect((await f.service.processStart('account', '51999999999')).state).toBe('ASK_FIRST_TATTOO');
    expect(f.current().currentState).toBe('ASK_FIRST_TATTOO');
  });
  it.each([true, false])(
    'asks centimeters after same-size=%s and preserves the answer',
    async (value) => {
      const f = fixture({ currentState: 'ASK_SAME_SIZE' });
      expect(
        (await f.service.processOptionSelection('account', 'phone', { stage: 'sameSize', value }))
          .state,
      ).toBe('ASK_DESIRED_SIZE_CM');
      expect(f.current().sameSizeAsReference).toBe(value);
      expect(f.current().targetSizeCm).toBeNull();
      expect((await f.service.processTextMessage('account', 'phone', '12.5')).state).toBe(
        'ASK_COLOR',
      );
      expect(f.current().targetSizeCm).toBe(12.5);
    },
  );
  it('lets only one concurrent color response advance and send its prompt', async () => {
    const f = fixture({ currentState: 'ASK_COLOR' });
    const responses = await Promise.all(
      ['BLACK_ONLY', 'FULL_COLOR'].map((value) =>
        f.service.processOptionSelection('account', 'phone', {
          stage: 'color',
          value: value as 'BLACK_ONLY' | 'FULL_COLOR',
        }),
      ),
    );
    expect(responses.filter((r) => r.messages.length > 0)).toHaveLength(1);
    expect(f.current().colorDeclaration).toBe('BLACK_ONLY');
  });
  it('ignores a delayed color button during placement', async () => {
    const f = fixture({ currentState: 'ASK_BODY_PART' });
    expect(
      (
        await f.service.processOptionSelection('account', 'phone', {
          stage: 'color',
          value: 'MOSTLY_COLOR',
        })
      ).messages,
    ).toEqual([]);
    expect(f.applyTransition).not.toHaveBeenCalled();
  });
  it('stores the reference through the current intake', async () => {
    const f = fixture({ currentState: 'WAITING_IMAGE', firstTattoo: false });
    expect((await f.service.processImageMessage('account', 'phone', VISION_IMAGE)).state).toBe(
      'ASK_SAME_SIZE',
    );
    expect(f.storeReference).toHaveBeenCalledOnce();
    expect(f.process).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    'refreshes activity for unexpected image or storage failure=%s',
    async (storageFailure) => {
      const f = fixture({
        currentState: storageFailure ? 'WAITING_IMAGE' : 'ASK_COLOR',
        firstTattoo: true,
      });
      if (storageFailure) f.storeReference.mockRejectedValue(new LeadImageStorageException());
      expect((await f.service.processImageMessage('account', 'phone', VISION_IMAGE)).state).toBe(
        f.current().currentState,
      );
      expect(f.applyTransition).toHaveBeenCalledWith(
        'account',
        'conversation',
        f.current().currentState,
        {},
      );
    },
  );
  it('remains silent after handoff', async () => {
    const f = fixture({ currentState: 'HANDOFF_TO_TATTOO_ARTIST', status: 'COMPLETED' });
    expect((await f.service.processTextMessage('account', 'phone', 'Hola')).messages).toEqual([]);
    expect(f.applyTransition).not.toHaveBeenCalled();
  });
});

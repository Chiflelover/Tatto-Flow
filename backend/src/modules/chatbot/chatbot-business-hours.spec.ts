import {
  ConversationState,
  ConversationStatus,
  DetailLevel,
  TattooSize,
  type Conversation,
  type Customer,
} from '../../generated/prisma/client.js';
import { ConfigService } from '@nestjs/config';
import { ConversationsService } from '../conversations/conversations.service.js';
import { CustomersService } from '../customers/customers.service.js';
import { ImageAnalysisWorkflowService } from '../image-analysis/image-analysis-workflow.service.js';
import { ChatbotService } from './chatbot.service.js';
import { NitaStateMachine } from './domain/nita-state-machine.js';
import { NitaBusinessHoursService } from './nita-business-hours.service.js';

const OUT_OF_HOURS_MESSAGE =
  'Hola 👋 En este momento estamos fuera de nuestro horario de atención.\nNuestro horario es de 6:00 a. m. a 10:00 p. m.\nEscríbenos nuevamente dentro de ese horario y Nita te ayudará con tu cotización.';

interface FixtureOptions {
  authorizeCustomerPhone?: boolean;
  businessHoursTestPhone?: string;
  conversationOverrides?: Partial<Conversation>;
}

function createFixture(options: FixtureOptions = {}) {
  const now = new Date('2026-09-15T03:00:00.000Z');
  const customer: Customer = {
    id: '24d0e8b1-4dd8-4231-8b91-f52734d6bf5e',
    phoneNumber: '+51999999999',
    lastOutOfHoursNoticeKey: null,
    createdAt: now,
    updatedAt: now,
  };
  const conversation: Conversation = {
    id: 'a459f257-b03c-48f4-9091-2dc37871ef81',
    customerId: customer.id,
    currentState: ConversationState.ASK_DETAIL,
    status: ConversationStatus.ACTIVE,
    selectedSize: TattooSize.SMALL,
    selectedDetail: null,
    bodyPart: null,
    lastActivityAt: new Date('2026-09-15T02:30:00.000Z'),
    createdAt: now,
    updatedAt: now,
    ...options.conversationOverrides,
  };
  const advancedConversation: Conversation = {
    ...conversation,
    currentState: ConversationState.ASK_BODY_PART,
    selectedDetail: DetailLevel.LIGHT,
  };
  const findOrCreateByPhoneNumber = vi.fn().mockResolvedValue(customer);
  const claimOutOfHoursNotice = vi.fn().mockResolvedValue(true);
  const findCurrentForCustomer = vi.fn().mockResolvedValue(conversation);
  const getOrCreateActive = vi.fn().mockResolvedValue({ conversation, created: false });
  const applyTransition = vi.fn().mockResolvedValue({
    conversation: advancedConversation,
    applied: true,
  });
  const businessHoursTestPhone = options.authorizeCustomerPhone
    ? customer.phoneNumber
    : options.businessHoursTestPhone;
  const service = new ChatbotService(
    {
      findOrCreateByPhoneNumber,
      claimOutOfHoursNotice,
    } as unknown as CustomersService,
    {
      findCurrentForCustomer,
      getOrCreateActive,
      applyTransition,
    } as unknown as ConversationsService,
    new NitaStateMachine(),
    {} as ImageAnalysisWorkflowService,
    new NitaBusinessHoursService(),
    new ConfigService({ BUSINESS_HOURS_TEST_PHONE: businessHoursTestPhone }),
  );

  return {
    service,
    customer,
    conversation,
    claimOutOfHoursNotice,
    findCurrentForCustomer,
    getOrCreateActive,
    applyTransition,
  };
}

describe('ChatbotService business-hour gating', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not advance an incomplete conversation at 22:00 in Lima', async () => {
    vi.setSystemTime(new Date('2026-09-15T03:00:00.000Z'));
    const fixture = createFixture({
      businessHoursTestPhone: 'different-test-identifier',
    });

    const response = await fixture.service.processOptionSelection(fixture.customer.phoneNumber, {
      stage: 'detail',
      value: DetailLevel.LIGHT,
    });

    expect(response).toEqual({
      state: ConversationState.ASK_DETAIL,
      messages: [{ type: 'text', text: OUT_OF_HOURS_MESSAGE }],
      options: [],
    });
    expect(fixture.findCurrentForCustomer).toHaveBeenCalledWith(fixture.customer.id);
    expect(fixture.getOrCreateActive).not.toHaveBeenCalled();
    expect(fixture.applyTransition).not.toHaveBeenCalled();
  });

  it('continues outside business hours only for the exactly authorized test phone', async () => {
    vi.setSystemTime(new Date('2026-09-15T03:00:00.000Z'));
    const fixture = createFixture({
      authorizeCustomerPhone: true,
    });

    const response = await fixture.service.processOptionSelection(fixture.customer.phoneNumber, {
      stage: 'detail',
      value: DetailLevel.LIGHT,
    });

    expect(fixture.getOrCreateActive).toHaveBeenCalledWith(fixture.customer.id);
    expect(fixture.applyTransition).toHaveBeenCalledWith(
      fixture.conversation.id,
      ConversationState.ASK_DETAIL,
      {
        selectedDetail: DetailLevel.LIGHT,
        currentState: ConversationState.ASK_BODY_PART,
      },
    );
    expect(fixture.findCurrentForCustomer).not.toHaveBeenCalled();
    expect(fixture.claimOutOfHoursNotice).not.toHaveBeenCalled();
    expect(response.state).toBe(ConversationState.ASK_BODY_PART);
  });

  it.each([
    ['normal phone', false],
    ['authorized test phone', true],
  ])('keeps the normal flow during business hours for the %s', async (_, authorized) => {
    vi.setSystemTime(new Date('2026-09-15T11:00:00.000Z'));
    const fixture = createFixture({
      authorizeCustomerPhone: authorized,
      businessHoursTestPhone: authorized ? undefined : 'different-test-identifier',
    });

    const response = await fixture.service.processOptionSelection(fixture.customer.phoneNumber, {
      stage: 'detail',
      value: DetailLevel.LIGHT,
    });

    expect(fixture.getOrCreateActive).toHaveBeenCalledWith(fixture.customer.id);
    expect(fixture.applyTransition).toHaveBeenCalledOnce();
    expect(fixture.claimOutOfHoursNotice).not.toHaveBeenCalled();
    expect(response.state).toBe(ConversationState.ASK_BODY_PART);
  });

  it('preserves the original closed behavior when the variable is absent', async () => {
    vi.setSystemTime(new Date('2026-09-15T03:00:00.000Z'));
    const fixture = createFixture();

    const response = await fixture.service.processTextMessage(fixture.customer.phoneNumber, 'Hola');

    expect(response.messages).toEqual([{ type: 'text', text: OUT_OF_HOURS_MESSAGE }]);
    expect(fixture.findCurrentForCustomer).toHaveBeenCalledWith(fixture.customer.id);
    expect(fixture.getOrCreateActive).not.toHaveBeenCalled();
    expect(fixture.applyTransition).not.toHaveBeenCalled();
  });

  it('sends the closed notice only once during the same night', async () => {
    vi.setSystemTime(new Date('2026-09-15T04:00:00.000Z'));
    const fixture = createFixture();
    fixture.claimOutOfHoursNotice.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const first = await fixture.service.processTextMessage(fixture.customer.phoneNumber, 'Hola');
    const repeated = await fixture.service.processTextMessage(fixture.customer.phoneNumber, 'Hola');

    expect(first.messages).toEqual([{ type: 'text', text: OUT_OF_HOURS_MESSAGE }]);
    expect(repeated.messages).toEqual([]);
    expect(fixture.claimOutOfHoursNotice).toHaveBeenNthCalledWith(
      1,
      fixture.customer.id,
      '2026-09-14',
    );
    expect(fixture.claimOutOfHoursNotice).toHaveBeenNthCalledWith(
      2,
      fixture.customer.id,
      '2026-09-14',
    );
  });

  it('continues the preserved conversation when the customer returns the next morning', async () => {
    const fixture = createFixture();
    vi.setSystemTime(new Date('2026-09-15T03:00:00.000Z'));

    await fixture.service.processOptionSelection(fixture.customer.phoneNumber, {
      stage: 'detail',
      value: DetailLevel.LIGHT,
    });

    vi.setSystemTime(new Date('2026-09-15T11:00:00.000Z'));
    const response = await fixture.service.processOptionSelection(fixture.customer.phoneNumber, {
      stage: 'detail',
      value: DetailLevel.LIGHT,
    });

    expect(fixture.getOrCreateActive).toHaveBeenCalledWith(fixture.customer.id);
    expect(fixture.applyTransition).toHaveBeenCalledWith(
      fixture.conversation.id,
      ConversationState.ASK_DETAIL,
      {
        selectedDetail: DetailLevel.LIGHT,
        currentState: ConversationState.ASK_BODY_PART,
      },
    );
    expect(response.state).toBe(ConversationState.ASK_BODY_PART);
  });

  it('remains silent outside business hours after a completed handoff', async () => {
    vi.setSystemTime(new Date('2026-09-15T03:00:00.000Z'));
    const fixture = createFixture({
      conversationOverrides: {
        currentState: ConversationState.HANDOFF_TO_TATTOO_ARTIST,
        status: ConversationStatus.COMPLETED,
      },
    });

    const response = await fixture.service.processTextMessage(
      fixture.customer.phoneNumber,
      '¿Sigues ahí?',
    );

    expect(response).toEqual({
      state: ConversationState.HANDOFF_TO_TATTOO_ARTIST,
      messages: [],
      options: [],
    });
    expect(fixture.claimOutOfHoursNotice).not.toHaveBeenCalled();
    expect(fixture.getOrCreateActive).not.toHaveBeenCalled();
    expect(fixture.applyTransition).not.toHaveBeenCalled();
  });
});

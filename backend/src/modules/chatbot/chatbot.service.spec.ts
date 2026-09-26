import {
  ConversationState,
  ConversationStatus,
  DetailLevel,
  LeadStatus,
  TattooSize,
  type Conversation,
  type Customer,
} from '../../generated/prisma/client.js';
import { ConfigService } from '@nestjs/config';
import { ConversationsService } from '../conversations/conversations.service.js';
import { CustomersService } from '../customers/customers.service.js';
import { ImageAnalysisWorkflowService } from '../image-analysis/image-analysis-workflow.service.js';
import { LeadImageStorageException } from '../storage/lead-image.service.js';
import { ChatbotService } from './chatbot.service.js';
import { NitaStateMachine } from './domain/nita-state-machine.js';
import { NitaBusinessHoursService } from './nita-business-hours.service.js';

describe('ChatbotService', () => {
  it('finds or creates the customer and starts an active conversation', async () => {
    const now = new Date();
    const customer: Customer = {
      id: '24d0e8b1-4dd8-4231-8b91-f52734d6bf5e',
      phoneNumber: '+51999999999',
      lastOutOfHoursNoticeKey: null,
      createdAt: now,
      updatedAt: now,
    };
    const startedConversation: Conversation = {
      id: 'a459f257-b03c-48f4-9091-2dc37871ef81',
      customerId: customer.id,
      currentState: ConversationState.START,
      status: ConversationStatus.ACTIVE,
      selectedSize: null,
      selectedDetail: null,
      bodyPart: null,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    };
    const advancedConversation: Conversation = {
      ...startedConversation,
      currentState: ConversationState.ASK_SIZE,
    };
    const findOrCreateByPhoneNumber = vi
      .fn<CustomersService['findOrCreateByPhoneNumber']>()
      .mockResolvedValue(customer);
    const getOrCreateActive = vi
      .fn<ConversationsService['getOrCreateActive']>()
      .mockResolvedValue({ conversation: startedConversation, created: true });
    const applyTransition = vi
      .fn<ConversationsService['applyTransition']>()
      .mockResolvedValue({ conversation: advancedConversation, applied: true });
    const customersService = { findOrCreateByPhoneNumber } as unknown as CustomersService;
    const conversationsService = {
      getOrCreateActive,
      applyTransition,
    } as unknown as ConversationsService;
    const service = new ChatbotService(
      customersService,
      conversationsService,
      new NitaStateMachine(),
      {} as ImageAnalysisWorkflowService,
      openBusinessHours(),
      new ConfigService(),
    );

    const response = await service.processStart(customer.phoneNumber);

    expect(findOrCreateByPhoneNumber).toHaveBeenCalledWith(customer.phoneNumber);
    expect(getOrCreateActive).toHaveBeenCalledWith(customer.id);
    expect(applyTransition).toHaveBeenCalledWith(startedConversation.id, ConversationState.START, {
      currentState: ConversationState.ASK_SIZE,
    });
    expect(response.state).toBe(ConversationState.ASK_SIZE);
  });

  it('lets only one of two simultaneous detail replies enter BODY_PART and send its prompt', async () => {
    const now = new Date();
    const customer = makeCustomer(now);
    const detailConversation = makeConversation(customer.id, now, {
      currentState: ConversationState.ASK_DETAIL,
      status: ConversationStatus.ACTIVE,
      selectedDetail: null,
      bodyPart: null,
    });
    let currentConversation = detailConversation;
    const appliedUpdates: Array<{ selectedDetail?: DetailLevel }> = [];
    const applyTransition = vi.fn<ConversationsService['applyTransition']>(
      (_conversationId, expectedState, update) => {
        if (currentConversation.currentState !== expectedState) {
          return Promise.resolve({ applied: false, conversation: currentConversation });
        }

        appliedUpdates.push(update);
        currentConversation = { ...currentConversation, ...update };
        return Promise.resolve({ applied: true, conversation: currentConversation });
      },
    );
    const service = new ChatbotService(
      {
        findOrCreateByPhoneNumber: vi.fn().mockResolvedValue(customer),
      } as unknown as CustomersService,
      {
        getOrCreateActive: vi.fn().mockResolvedValue({
          conversation: detailConversation,
          created: false,
        }),
        applyTransition,
      } as unknown as ConversationsService,
      new NitaStateMachine(),
      {} as ImageAnalysisWorkflowService,
      openBusinessHours(),
      new ConfigService(),
    );

    const responses = await Promise.all([
      service.processOptionSelection(customer.phoneNumber, {
        stage: 'detail',
        value: DetailLevel.DETAILED,
      }),
      service.processOptionSelection(customer.phoneNumber, {
        stage: 'detail',
        value: DetailLevel.LIGHT,
      }),
    ]);

    expect(appliedUpdates).toHaveLength(1);
    expect(currentConversation.currentState).toBe(ConversationState.ASK_BODY_PART);
    expect([DetailLevel.DETAILED, DetailLevel.LIGHT]).toContain(currentConversation.selectedDetail);
    expect(responses.flatMap(({ messages }) => messages)).toEqual([
      { type: 'text', text: '¿En qué parte del cuerpo te gustaría hacerte el tatuaje?' },
    ]);
  });

  it('ignores a late detail button in BODY_PART without changing the selected detail', async () => {
    const now = new Date();
    const customer = makeCustomer(now);
    const bodyPartConversation = makeConversation(customer.id, now, {
      currentState: ConversationState.ASK_BODY_PART,
      status: ConversationStatus.ACTIVE,
      selectedDetail: DetailLevel.DETAILED,
      bodyPart: null,
    });
    const applyTransition = vi.fn<ConversationsService['applyTransition']>();
    const service = new ChatbotService(
      {
        findOrCreateByPhoneNumber: vi.fn().mockResolvedValue(customer),
      } as unknown as CustomersService,
      {
        getOrCreateActive: vi.fn().mockResolvedValue({
          conversation: bodyPartConversation,
          created: false,
        }),
        applyTransition,
      } as unknown as ConversationsService,
      new NitaStateMachine(),
      {} as ImageAnalysisWorkflowService,
      openBusinessHours(),
      new ConfigService(),
    );

    const response = await service.processOptionSelection(customer.phoneNumber, {
      stage: 'detail',
      value: DetailLevel.LIGHT,
    });

    expect(response).toEqual({
      state: ConversationState.ASK_BODY_PART,
      messages: [],
      options: [],
    });
    expect(applyTransition).not.toHaveBeenCalled();
    expect(bodyPartConversation.selectedDetail).toBe(DetailLevel.DETAILED);
  });

  it('does not overwrite SMALL when a delayed size button arrives in ASK_DETAIL', async () => {
    const now = new Date();
    const customer = makeCustomer(now);
    const detailConversation = makeConversation(customer.id, now, {
      currentState: ConversationState.ASK_DETAIL,
      status: ConversationStatus.ACTIVE,
      selectedSize: TattooSize.SMALL,
      selectedDetail: null,
      bodyPart: null,
    });
    const applyTransition = vi.fn<ConversationsService['applyTransition']>();
    const service = new ChatbotService(
      {
        findOrCreateByPhoneNumber: vi.fn().mockResolvedValue(customer),
      } as unknown as CustomersService,
      {
        getOrCreateActive: vi.fn().mockResolvedValue({
          conversation: detailConversation,
          created: false,
        }),
        applyTransition,
      } as unknown as ConversationsService,
      new NitaStateMachine(),
      {} as ImageAnalysisWorkflowService,
      openBusinessHours(),
      new ConfigService(),
    );

    const response = await service.processOptionSelection(customer.phoneNumber, {
      stage: 'size',
      value: TattooSize.MEDIUM,
    });

    expect(response).toEqual({
      state: ConversationState.ASK_DETAIL,
      messages: [],
      options: [],
    });
    expect(applyTransition).not.toHaveBeenCalled();
    expect(detailConversation.selectedSize).toBe(TattooSize.SMALL);
    expect(detailConversation.selectedDetail).toBeNull();
  });

  it('accepts a valid text in BODY_PART and continues to the image request', async () => {
    const now = new Date();
    const customer = makeCustomer(now);
    const bodyPartConversation = makeConversation(customer.id, now, {
      currentState: ConversationState.ASK_BODY_PART,
      status: ConversationStatus.ACTIVE,
      selectedDetail: DetailLevel.DETAILED,
      bodyPart: null,
    });
    const waitingImageConversation = {
      ...bodyPartConversation,
      currentState: ConversationState.WAITING_IMAGE,
      bodyPart: 'brazo',
    };
    const applyTransition = vi
      .fn<ConversationsService['applyTransition']>()
      .mockResolvedValue({ applied: true, conversation: waitingImageConversation });
    const service = new ChatbotService(
      {
        findOrCreateByPhoneNumber: vi.fn().mockResolvedValue(customer),
      } as unknown as CustomersService,
      {
        getOrCreateActive: vi.fn().mockResolvedValue({
          conversation: bodyPartConversation,
          created: false,
        }),
        applyTransition,
      } as unknown as ConversationsService,
      new NitaStateMachine(),
      {} as ImageAnalysisWorkflowService,
      openBusinessHours(),
      new ConfigService(),
    );

    const response = await service.processTextMessage(customer.phoneNumber, '  brazo  ');

    expect(applyTransition).toHaveBeenCalledWith(
      bodyPartConversation.id,
      ConversationState.ASK_BODY_PART,
      { bodyPart: 'brazo', currentState: ConversationState.WAITING_IMAGE },
    );
    expect(response).toEqual({
      state: ConversationState.WAITING_IMAGE,
      messages: [
        {
          type: 'text',
          text: 'Perfecto. Ahora envíame una imagen de referencia del tatuaje que tienes en mente.\n\nNo tiene que ser exactamente el mismo diseño. Lo ideal es que sea un tatuaje ya hecho sobre la piel, parecido a lo que buscas en tamaño y nivel de detalle.\n\n(Puede ser un tatuaje que hayas encontrado en Instagram, Pinterest o cualquier otra referencia.)',
        },
      ],
      options: [],
    });
  });

  it.each([
    {
      status: LeadStatus.VERIFIED,
      pricingRule: {
        ruleId: 'ce16a85c-cc5b-43de-8a56-1b2ef568fd39',
        version: 1,
        minPrice: '500',
        maxPrice: '700',
      },
      expected:
        'Por lo que me indicaste y según la referencia enviada, el precio aproximado estaría entre S/500 y S/700.\n\nEl precio final lo confirma el tatuador del estudio después de revisar el diseño.\n\nSe pondrá en contacto contigo muy pronto para confirmar el precio exacto.',
    },
    {
      status: LeadStatus.REQUIRES_REVIEW,
      pricingRule: null,
      expected:
        'Perfecto, ya tengo toda la información y tu referencia.\n\nUn tatuador del estudio revisará tu idea para darte el precio exacto.\n\nTu solicitud ya está en revisión y te avisaremos cuando esté lista.',
    },
  ])(
    'returns the exact final Nita message for $status',
    async ({ status, pricingRule, expected }) => {
      const now = new Date();
      const customer = makeCustomer(now);
      const waitingConversation = makeConversation(customer.id, now, {
        currentState: ConversationState.WAITING_IMAGE,
        status: ConversationStatus.ACTIVE,
      });
      const analyzingConversation = {
        ...waitingConversation,
        currentState: ConversationState.ANALYZING,
      };
      const completedConversation = {
        ...waitingConversation,
        currentState: ConversationState.HANDOFF_TO_TATTOO_ARTIST,
        status: ConversationStatus.COMPLETED,
      };
      const imageAnalysisWorkflow = {
        analyzeConversationImage: vi.fn().mockResolvedValue({
          analysis: {
            detectedSize: TattooSize.MEDIUM,
            sizeConfidence: 0.95,
            detectedDetail: DetailLevel.DETAILED,
            detailConfidence: 0.95,
          },
          conversation: completedConversation,
          quotation: { status, reviewReasons: [], pricingRule },
        }),
      } as unknown as ImageAnalysisWorkflowService;
      const service = new ChatbotService(
        {
          findOrCreateByPhoneNumber: vi.fn().mockResolvedValue(customer),
        } as unknown as CustomersService,
        {
          getOrCreateActive: vi.fn().mockResolvedValue({
            conversation: waitingConversation,
            created: false,
          }),
          applyTransition: vi.fn().mockResolvedValue({
            conversation: analyzingConversation,
            applied: true,
          }),
        } as unknown as ConversationsService,
        new NitaStateMachine(),
        imageAnalysisWorkflow,
        openBusinessHours(),
        new ConfigService(),
      );

      const response = await service.processImageMessage(customer.phoneNumber, {
        content: new Uint8Array([1]),
        mimeType: 'image/png',
      });

      expect(response).toMatchObject({
        state: ConversationState.HANDOFF_TO_TATTOO_ARTIST,
        messages: [{ type: 'text', text: expected }],
        options: [],
      });
    },
  );

  it('does not respond as Nita or restart after handoff', async () => {
    const now = new Date();
    const customer = makeCustomer(now);
    const handedOffConversation = makeConversation(customer.id, now, {
      currentState: ConversationState.HANDOFF_TO_TATTOO_ARTIST,
      status: ConversationStatus.COMPLETED,
    });
    const applyTransition = vi.fn();
    const service = new ChatbotService(
      {
        findOrCreateByPhoneNumber: vi.fn().mockResolvedValue(customer),
      } as unknown as CustomersService,
      {
        getOrCreateActive: vi.fn().mockResolvedValue({
          conversation: handedOffConversation,
          created: false,
        }),
        applyTransition,
      } as unknown as ConversationsService,
      new NitaStateMachine(),
      {} as ImageAnalysisWorkflowService,
      openBusinessHours(),
      new ConfigService(),
    );

    const response = await service.processTextMessage(
      customer.phoneNumber,
      '¿Qué horarios tienen?',
    );

    expect(response).toEqual({
      state: ConversationState.HANDOFF_TO_TATTOO_ARTIST,
      messages: [],
      options: [],
    });
    expect(applyTransition).not.toHaveBeenCalled();
  });

  it('returns to WAITING_IMAGE with a friendly message when storage fails', async () => {
    const now = new Date();
    const customer = makeCustomer(now);
    const waitingConversation = makeConversation(customer.id, now, {
      currentState: ConversationState.WAITING_IMAGE,
      status: ConversationStatus.ACTIVE,
    });
    const analyzingConversation = {
      ...waitingConversation,
      currentState: ConversationState.ANALYZING,
    };
    const applyTransition = vi
      .fn<ConversationsService['applyTransition']>()
      .mockResolvedValueOnce({ conversation: analyzingConversation, applied: true })
      .mockResolvedValueOnce({ conversation: waitingConversation, applied: true });
    const service = new ChatbotService(
      {
        findOrCreateByPhoneNumber: vi.fn().mockResolvedValue(customer),
      } as unknown as CustomersService,
      {
        getOrCreateActive: vi.fn().mockResolvedValue({
          conversation: waitingConversation,
          created: false,
        }),
        applyTransition,
      } as unknown as ConversationsService,
      new NitaStateMachine(),
      {
        analyzeConversationImage: vi.fn().mockRejectedValue(new LeadImageStorageException()),
      } as unknown as ImageAnalysisWorkflowService,
      openBusinessHours(),
      new ConfigService(),
    );

    const response = await service.processImageMessage(customer.phoneNumber, {
      content: new Uint8Array([1]),
      mimeType: 'image/png',
    });

    expect(response).toEqual({
      state: ConversationState.WAITING_IMAGE,
      messages: [
        {
          type: 'text',
          text: 'No pudimos guardar la imagen de referencia. Inténtalo nuevamente.',
        },
      ],
      options: [],
    });
    expect(applyTransition).toHaveBeenLastCalledWith(
      waitingConversation.id,
      ConversationState.ANALYZING,
      { currentState: ConversationState.WAITING_IMAGE },
    );
  });
});

function makeCustomer(now: Date): Customer {
  return {
    id: '24d0e8b1-4dd8-4231-8b91-f52734d6bf5e',
    phoneNumber: '+51999999999',
    lastOutOfHoursNoticeKey: null,
    createdAt: now,
    updatedAt: now,
  };
}

function openBusinessHours(): NitaBusinessHoursService {
  return {
    isOpen: vi.fn().mockReturnValue(true),
    getClosedPeriodKey: vi.fn(),
  };
}

function makeConversation(
  customerId: string,
  now: Date,
  overrides: Partial<Conversation>,
): Conversation {
  return {
    id: 'a459f257-b03c-48f4-9091-2dc37871ef81',
    customerId,
    currentState: ConversationState.START,
    status: ConversationStatus.ACTIVE,
    selectedSize: TattooSize.MEDIUM,
    selectedDetail: DetailLevel.DETAILED,
    bodyPart: 'Brazo',
    lastActivityAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

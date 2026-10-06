import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConversationState,
  ConversationStatus,
  type Conversation,
  type Prisma,
} from '../../generated/prisma/client.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { CustomersService } from '../customers/customers.service.js';
import { LeadImageStorageException } from '../storage/lead-image.service.js';
import type {
  ChatbotDecision,
  ChatbotImageInput,
  ChatbotInput,
  ChatbotOptionSelection,
  ChatbotResponse,
  DurableV2Input,
} from './domain/chatbot.types.js';
import { NitaV2StateMachine } from './domain/nita-v2-state-machine.js';
import { NitaBusinessHoursService } from './nita-business-hours.service.js';
import { NitaV2IntakeService } from './nita-v2-intake.service.js';
import { NitaV2AnalysisService } from './nita-v2-analysis.service.js';
import { V2_ANALYSIS_STATES, V2_DECISION_STATES } from './domain/nita-v2-decision.js';
import { NitaV2CompletionService } from './nita-v2-completion.service.js';
import { v2BookingSelection } from './domain/nita-v2-messages.js';

const OUT_OF_HOURS_MESSAGE =
  'Hola 👋 En este momento estamos fuera de nuestro horario de atención.\nNuestro horario es de 6:00 a. m. a 10:00 p. m.\nEscríbenos nuevamente dentro de ese horario y Nita te ayudará con tu cotización.';

type ConversationAccess =
  | { conversation: Conversation; response?: never }
  | { conversation?: never; response: ChatbotResponse };

@Injectable()
export class ChatbotService {
  constructor(
    @Inject(CustomersService)
    private readonly customersService: CustomersService,
    @Inject(ConversationsService)
    private readonly conversationsService: ConversationsService,
    @Inject(NitaV2StateMachine)
    private readonly stateMachine: NitaV2StateMachine,
    @Inject(NitaBusinessHoursService)
    private readonly businessHours: NitaBusinessHoursService,
    @Inject(ConfigService)
    private readonly configService: ConfigService,
    @Inject(NitaV2IntakeService)
    private readonly v2Intake: NitaV2IntakeService,
    @Inject(NitaV2AnalysisService)
    private readonly v2Analysis: NitaV2AnalysisService,
    @Inject(NitaV2CompletionService)
    private readonly v2Completion: NitaV2CompletionService,
  ) {}

  async processStart(accountId: string, customerIdentifier: string): Promise<ChatbotResponse> {
    const access = await this.getConversationAccess(accountId, customerIdentifier);

    if (access.response) {
      return access.response;
    }

    const { conversation } = access;

    if (this.isProcessingOrDecided(conversation))
      return this.silentResponse(conversation.currentState);

    if (this.isHandedOff(conversation)) {
      return this.silentHandoff();
    }

    if (conversation.currentState !== ConversationState.START) {
      return this.applyDecision(conversation, {
        update: {},
        response: this.stateMachine.prompt(conversation),
      });
    }

    return this.applyDecision(conversation, this.stateMachine.begin());
  }

  processOptionSelection(
    accountId: string,
    customerIdentifier: string,
    selection: ChatbotOptionSelection,
    durable?: DurableV2Input,
  ): Promise<ChatbotResponse> {
    return this.processInput(
      accountId,
      customerIdentifier,
      { type: 'option', ...selection },
      durable,
    );
  }

  async resumePendingV2Analysis(accountId: string, customerIdentifier: string): Promise<void> {
    await this.v2Analysis.resumePendingForCustomer(accountId, customerIdentifier);
    await this.v2Completion.resumePendingForCustomer(accountId, customerIdentifier);
  }

  processTextMessage(
    accountId: string,
    customerIdentifier: string,
    message: string,
    durable?: DurableV2Input,
  ): Promise<ChatbotResponse> {
    return this.processInput(
      accountId,
      customerIdentifier,
      { type: 'text', value: message },
      durable,
    );
  }

  async processImageMessage(
    accountId: string,
    customerIdentifier: string,
    image: ChatbotImageInput,
    durable?: DurableV2Input,
  ): Promise<ChatbotResponse> {
    const access = await this.getConversationAccess(accountId, customerIdentifier, durable);

    if (access.response) {
      return access.response;
    }

    const { conversation } = access;

    if (this.isProcessingOrDecided(conversation))
      return this.silentResponse(conversation.currentState);

    if (this.isHandedOff(conversation)) {
      return this.silentHandoff();
    }

    const decision = this.stateMachine.process(conversation, { type: 'image', image });
    if (decision.update.currentState !== ConversationState.ASK_SAME_SIZE)
      return decision.ignored
        ? decision.response
        : this.applyDecision(conversation, decision, durable);
    try {
      const result = await this.v2Intake.storeReference(
        accountId,
        conversation.id,
        image,
        durable ? (tx, updated) => durable.checkpoint(tx, updated, decision.response) : undefined,
      );
      return result.applied
        ? decision.response
        : this.silentResponse(result.conversation.currentState);
    } catch (error) {
      if (durable) throw error;
      if (error instanceof LeadImageStorageException || error instanceof BadRequestException) {
        return this.applyDecision(conversation, {
          update: {},
          response: {
            state: ConversationState.WAITING_IMAGE,
            messages: [{ type: 'text', text: error.message }],
            options: [],
          },
        });
      }
      throw error;
    }
  }

  private async processInput(
    accountId: string,
    customerIdentifier: string,
    input: ChatbotInput,
    durable?: DurableV2Input,
  ): Promise<ChatbotResponse> {
    const access = await this.getConversationAccess(accountId, customerIdentifier, durable);

    if (access.response) {
      return access.response;
    }

    const { conversation } = access;

    if (conversation.currentState === ConversationState.ASK_ADVANCE_INTENT) {
      const intent = v2BookingSelection(input);
      if (intent) {
        const handedOff = await this.v2Completion.recordIntent(
          accountId,
          conversation.id,
          conversation.customerId,
          intent,
          durable
            ? (tx, updated) =>
                durable.checkpoint(tx, updated, this.silentResponse(updated.currentState))
            : undefined,
        );
        return this.silentResponse(handedOff.currentState);
      }
      return input.type === 'text'
        ? {
            state: conversation.currentState,
            messages: [
              { type: 'text', text: 'Selecciona “Separar cita” o “Contactarme” para continuar.' },
            ],
            options: [],
          }
        : this.silentResponse(conversation.currentState);
    }

    if (this.isProcessingOrDecided(conversation))
      return this.silentResponse(conversation.currentState);

    if (this.isHandedOff(conversation)) {
      return this.silentHandoff();
    }

    const decision = this.stateMachine.process(conversation, input);

    if (decision.ignored) {
      return decision.response;
    }

    return this.applyDecision(conversation, decision, durable);
  }

  private async getConversationAccess(
    accountId: string,
    customerIdentifier: string,
    durable?: DurableV2Input,
  ): Promise<ConversationAccess> {
    const now = new Date();
    const customer = await this.customersService.findOrCreateByPhoneNumber(
      accountId,
      customerIdentifier,
    );

    if (!this.hasBusinessHoursTestBypass(customerIdentifier) && !this.businessHours.isOpen(now)) {
      const currentConversation = await this.conversationsService.findCurrentForCustomer(
        accountId,
        customer.id,
      );

      if (currentConversation && this.isHandedOff(currentConversation)) {
        return { response: this.silentHandoff() };
      }

      const shouldNotify = await this.customersService.claimOutOfHoursNotice(
        customer.id,
        this.businessHours.getClosedPeriodKey(now),
      );

      return {
        response: {
          state: currentConversation?.currentState ?? ConversationState.START,
          messages: shouldNotify ? [{ type: 'text', text: OUT_OF_HOURS_MESSAGE }] : [],
          options: [],
        },
      };
    }

    const access = await this.conversationsService.getOrCreateActive(accountId, customer.id);
    let conversation = access.conversation;

    if (!durable && V2_ANALYSIS_STATES.some((state) => state === conversation.currentState))
      conversation = await this.v2Analysis.process(accountId, conversation.id);
    if (
      !durable &&
      [...V2_DECISION_STATES, 'PRICE_READY'].some((state) => state === conversation.currentState)
    )
      conversation = await this.v2Completion.prepare(accountId, conversation.id);
    return { conversation };
  }

  private hasBusinessHoursTestBypass(customerIdentifier: string): boolean {
    const testPhone = this.configService.get<string>('BUSINESS_HOURS_TEST_PHONE');

    return Boolean(testPhone) && customerIdentifier === testPhone;
  }

  private async applyDecision(
    conversation: Conversation,
    decision: ChatbotDecision,
    durable?: DurableV2Input,
  ): Promise<ChatbotResponse> {
    const result = await this.v2Intake.applyTransition(
      conversation.accountId,
      conversation.id,
      conversation.currentState,
      decision.update,
      ...(durable
        ? [
            (tx: Prisma.TransactionClient, updated: Conversation) =>
              durable.checkpoint(tx, updated, decision.response),
          ]
        : []),
    );

    if (!result.applied) {
      if (this.isHandedOff(result.conversation)) {
        return this.silentHandoff();
      }

      return this.silentResponse(result.conversation.currentState);
    }

    if (!durable && result.conversation.currentState === ConversationState.READY_FOR_ANALYSIS) {
      const prepared = await this.v2Analysis.process(conversation.accountId, conversation.id);
      const completed = await this.v2Completion.prepare(conversation.accountId, prepared.id);
      return { ...decision.response, state: completed.currentState };
    }
    return decision.response;
  }

  private isProcessingOrDecided(conversation: Conversation): boolean {
    return [...V2_ANALYSIS_STATES, ...V2_DECISION_STATES, 'PRICE_READY', 'ASK_ADVANCE_INTENT'].some(
      (state) => state === conversation.currentState,
    );
  }

  private isHandedOff(conversation: Conversation): boolean {
    return (
      conversation.currentState === ConversationState.HANDOFF_TO_TATTOO_ARTIST &&
      conversation.status === ConversationStatus.COMPLETED
    );
  }

  private silentHandoff(): ChatbotResponse {
    return this.silentResponse(ConversationState.HANDOFF_TO_TATTOO_ARTIST);
  }

  private silentResponse(state: ConversationState): ChatbotResponse {
    return {
      state,
      messages: [],
      options: [],
    };
  }
}

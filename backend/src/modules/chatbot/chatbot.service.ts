import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConversationState,
  ConversationStatus,
  LeadStatus,
  type Conversation,
} from '../../generated/prisma/client.js';
import { ConversationsService } from '../conversations/conversations.service.js';
import { CustomersService } from '../customers/customers.service.js';
import { ImageAnalysisWorkflowService } from '../image-analysis/image-analysis-workflow.service.js';
import { LeadImageStorageException } from '../storage/lead-image.service.js';
import type {
  ChatbotDecision,
  ChatbotImageInput,
  ChatbotInput,
  ChatbotResponse,
} from './domain/chatbot.types.js';
import { NitaStateMachine } from './domain/nita-state-machine.js';
import { NitaBusinessHoursService } from './nita-business-hours.service.js';

const VERIFIED_MESSAGE = (minimum: string, maximum: string) =>
  `Por lo que me indicaste y según la referencia enviada, el precio aproximado estaría entre S/${minimum} y S/${maximum}.\n\nEl precio final lo confirma el tatuador del estudio después de revisar el diseño.\n\nSe pondrá en contacto contigo muy pronto para confirmar el precio exacto.`;
const REQUIRES_REVIEW_MESSAGE =
  'Perfecto, ya tengo toda la información y tu referencia.\n\nUn tatuador del estudio revisará tu idea para darte el precio exacto.\n\nTu solicitud ya está en revisión y te avisaremos cuando esté lista.';
const OUT_OF_HOURS_MESSAGE =
  'Hola 👋 En este momento estamos fuera de nuestro horario de atención.\nNuestro horario es de 6:00 a. m. a 10:00 p. m.\nEscríbenos nuevamente dentro de ese horario y Nita te ayudará con tu cotización.';

type ConversationAccess =
  | { conversation: Conversation; response?: never }
  | { conversation?: never; response: ChatbotResponse };

@Injectable()
export class ChatbotService {
  private readonly logger = new Logger(ChatbotService.name);

  constructor(
    @Inject(CustomersService)
    private readonly customersService: CustomersService,
    @Inject(ConversationsService)
    private readonly conversationsService: ConversationsService,
    @Inject(NitaStateMachine)
    private readonly stateMachine: NitaStateMachine,
    @Inject(ImageAnalysisWorkflowService)
    private readonly imageAnalysisWorkflow: ImageAnalysisWorkflowService,
    @Inject(NitaBusinessHoursService)
    private readonly businessHours: NitaBusinessHoursService,
    @Inject(ConfigService)
    private readonly configService: ConfigService,
  ) {}

  async processStart(customerIdentifier: string): Promise<ChatbotResponse> {
    const access = await this.getConversationAccess(customerIdentifier);

    if (access.response) {
      return access.response;
    }

    const { conversation } = access;

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

  processOptionSelection(customerIdentifier: string, option: string): Promise<ChatbotResponse> {
    return this.processInput(customerIdentifier, { type: 'option', value: option });
  }

  processTextMessage(customerIdentifier: string, message: string): Promise<ChatbotResponse> {
    return this.processInput(customerIdentifier, { type: 'text', value: message });
  }

  async processImageMessage(
    customerIdentifier: string,
    image: ChatbotImageInput,
  ): Promise<ChatbotResponse> {
    const access = await this.getConversationAccess(customerIdentifier);

    if (access.response) {
      return access.response;
    }

    const { conversation } = access;

    if (this.isHandedOff(conversation)) {
      return this.silentHandoff();
    }

    const decision = this.stateMachine.process(conversation, { type: 'image', image });
    const transition = await this.conversationsService.applyTransition(
      conversation.id,
      conversation.currentState,
      decision.update,
    );

    if (!transition.applied) {
      if (this.isHandedOff(transition.conversation)) {
        return this.silentHandoff();
      }

      return this.silentResponse(transition.conversation.currentState);
    }

    if (decision.update.currentState !== ConversationState.ANALYZING) {
      return decision.response;
    }

    try {
      const completedAnalysis = await this.imageAnalysisWorkflow.analyzeConversationImage(
        transition.conversation.id,
        image,
      );
      const pricingRule = completedAnalysis.quotation.pricingRule;
      const message =
        completedAnalysis.quotation.status === LeadStatus.VERIFIED && pricingRule
          ? VERIFIED_MESSAGE(pricingRule.minPrice, pricingRule.maxPrice)
          : REQUIRES_REVIEW_MESSAGE;

      return {
        state: ConversationState.HANDOFF_TO_TATTOO_ARTIST,
        messages: [{ type: 'text', text: message }],
        options: [],
        development: {
          imageAnalysis: completedAnalysis.analysis,
          quotation: completedAnalysis.quotation,
        },
      };
    } catch (error: unknown) {
      this.logger.error(
        `Image analysis workflow failed for conversation ${transition.conversation.id}.`,
      );

      if (error instanceof LeadImageStorageException) {
        try {
          await this.conversationsService.applyTransition(
            transition.conversation.id,
            ConversationState.ANALYZING,
            { currentState: ConversationState.WAITING_IMAGE },
          );
        } catch {
          this.logger.error(
            `Could not restore image retry state for conversation ${transition.conversation.id}.`,
          );
        }

        return {
          state: ConversationState.WAITING_IMAGE,
          messages: [{ type: 'text', text: error.message }],
          options: [],
        };
      }

      return {
        state: ConversationState.ANALYZING,
        messages: [
          {
            type: 'text',
            text: 'No pude completar el análisis. Tus datos quedaron guardados para revisión.',
          },
        ],
        options: [],
      };
    }
  }

  private async processInput(
    customerIdentifier: string,
    input: ChatbotInput,
  ): Promise<ChatbotResponse> {
    const access = await this.getConversationAccess(customerIdentifier);

    if (access.response) {
      return access.response;
    }

    const { conversation } = access;

    if (this.isHandedOff(conversation)) {
      return this.silentHandoff();
    }

    const decision = this.stateMachine.process(conversation, input);

    if (decision.ignored) {
      return decision.response;
    }

    return this.applyDecision(conversation, decision);
  }

  private async getConversationAccess(customerIdentifier: string): Promise<ConversationAccess> {
    const now = new Date();
    const customer = await this.customersService.findOrCreateByPhoneNumber(customerIdentifier);

    if (!this.hasBusinessHoursTestBypass(customerIdentifier) && !this.businessHours.isOpen(now)) {
      const currentConversation = await this.conversationsService.findCurrentForCustomer(
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

    const { conversation } = await this.conversationsService.getOrCreateActive(customer.id);

    return { conversation };
  }

  private hasBusinessHoursTestBypass(customerIdentifier: string): boolean {
    const testPhone = this.configService.get<string>('BUSINESS_HOURS_TEST_PHONE');

    return Boolean(testPhone) && customerIdentifier === testPhone;
  }

  private async applyDecision(
    conversation: Conversation,
    decision: ChatbotDecision,
  ): Promise<ChatbotResponse> {
    const result = await this.conversationsService.applyTransition(
      conversation.id,
      conversation.currentState,
      decision.update,
    );

    if (!result.applied) {
      if (this.isHandedOff(result.conversation)) {
        return this.silentHandoff();
      }

      return this.silentResponse(result.conversation.currentState);
    }

    return decision.response;
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

import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConversationState,
  ConversationStatus,
  FlowVersion,
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
  ChatbotOptionSelection,
  ChatbotResponse,
} from './domain/chatbot.types.js';
import { NitaStateMachine } from './domain/nita-state-machine.js';
import { NitaBusinessHoursService } from './nita-business-hours.service.js';
import { NitaV2IntakeService } from './nita-v2-intake.service.js';
import { NitaV2AnalysisService } from './nita-v2-analysis.service.js';
import { V2_ANALYSIS_STATES, V2_DECISION_STATES } from './domain/nita-v2-decision.js';

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
    @Inject(NitaV2IntakeService)
    private readonly v2Intake: NitaV2IntakeService,
    @Inject(NitaV2AnalysisService)
    private readonly v2Analysis: NitaV2AnalysisService,
  ) {}

  async processStart(accountId: string, customerIdentifier: string): Promise<ChatbotResponse> {
    const access = await this.getConversationAccess(accountId, customerIdentifier);

    if (access.response) {
      return access.response;
    }

    const { conversation } = access;

    if (this.isV2ProcessingOrDecided(conversation))
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

    return this.applyDecision(conversation, this.stateMachine.begin(conversation.flowVersion));
  }

  processOptionSelection(
    accountId: string,
    customerIdentifier: string,
    selection: ChatbotOptionSelection,
  ): Promise<ChatbotResponse> {
    return this.processInput(accountId, customerIdentifier, { type: 'option', ...selection });
  }

  resumePendingV2Analysis(accountId: string, customerIdentifier: string): Promise<void> {
    return this.v2Analysis.resumePendingForCustomer(accountId, customerIdentifier);
  }

  processTextMessage(
    accountId: string,
    customerIdentifier: string,
    message: string,
  ): Promise<ChatbotResponse> {
    return this.processInput(accountId, customerIdentifier, { type: 'text', value: message });
  }

  async processImageMessage(
    accountId: string,
    customerIdentifier: string,
    image: ChatbotImageInput,
  ): Promise<ChatbotResponse> {
    const access = await this.getConversationAccess(accountId, customerIdentifier);

    if (access.response) {
      return access.response;
    }

    const { conversation } = access;

    if (this.isV2ProcessingOrDecided(conversation))
      return this.silentResponse(conversation.currentState);

    if (this.isHandedOff(conversation)) {
      return this.silentHandoff();
    }

    const decision = this.stateMachine.process(conversation, { type: 'image', image });
    if (conversation.flowVersion === FlowVersion.V2) {
      if (decision.update.currentState !== ConversationState.ASK_SAME_SIZE)
        return decision.ignored ? decision.response : this.applyDecision(conversation, decision);
      try {
        const result = await this.v2Intake.storeReference(accountId, conversation.id, image);
        return result.applied
          ? decision.response
          : this.silentResponse(result.conversation.currentState);
      } catch (error) {
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
    accountId: string,
    customerIdentifier: string,
    input: ChatbotInput,
  ): Promise<ChatbotResponse> {
    const access = await this.getConversationAccess(accountId, customerIdentifier);

    if (access.response) {
      return access.response;
    }

    const { conversation } = access;

    if (this.isV2ProcessingOrDecided(conversation))
      return this.silentResponse(conversation.currentState);

    if (this.isHandedOff(conversation)) {
      return this.silentHandoff();
    }

    const decision = this.stateMachine.process(conversation, input);

    if (decision.ignored) {
      return decision.response;
    }

    return this.applyDecision(conversation, decision);
  }

  private async getConversationAccess(
    accountId: string,
    customerIdentifier: string,
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

    const defaultVersion =
      this.configService.get<FlowVersion>('NITA_DEFAULT_FLOW_VERSION') ?? FlowVersion.V1;
    const { conversation } =
      defaultVersion === FlowVersion.V1
        ? await this.conversationsService.getOrCreateActive(accountId, customer.id)
        : await this.conversationsService.getOrCreateActive(accountId, customer.id, defaultVersion);

    if (
      conversation.flowVersion === FlowVersion.V2 &&
      V2_ANALYSIS_STATES.some((state) => state === conversation.currentState)
    )
      return { conversation: await this.v2Analysis.process(accountId, conversation.id) };
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
    const result =
      conversation.flowVersion === FlowVersion.V2
        ? await this.v2Intake.applyTransition(
            conversation.accountId,
            conversation.id,
            conversation.currentState,
            decision.update,
          )
        : await this.conversationsService.applyTransition(
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

    if (
      result.conversation.flowVersion === FlowVersion.V2 &&
      result.conversation.currentState === ConversationState.READY_FOR_ANALYSIS
    ) {
      const prepared = await this.v2Analysis.process(conversation.accountId, conversation.id);
      return { ...decision.response, state: prepared.currentState };
    }
    return decision.response;
  }

  private isV2ProcessingOrDecided(conversation: Conversation): boolean {
    return (
      conversation.flowVersion === FlowVersion.V2 &&
      [...V2_ANALYSIS_STATES, ...V2_DECISION_STATES].some(
        (state) => state === conversation.currentState,
      )
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

import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ColorDeclaration, ConversationState } from '../../../generated/prisma/client.js';
import { ChatbotService } from '../chatbot.service.js';
import { V2_BOOKING_BUTTON_IDS } from '../domain/nita-v2-messages.js';
import type {
  ChatbotImageInput,
  ChatbotOption,
  ChatbotOptionSelection,
  ChatbotResponse,
  DurableV2Input,
} from '../domain/chatbot.types.js';

export const WHATSAPP_BUTTON_IDS = {
  FIRST_TATTOO_YES: 'nita_first_tattoo_yes',
  FIRST_TATTOO_NO: 'nita_first_tattoo_no',
  SAME_SIZE_YES: 'nita_same_size_yes',
  SAME_SIZE_NO: 'nita_same_size_no',
  COLOR_BLACK_ONLY: 'nita_color_black_only',
  COLOR_LOW: 'nita_color_low',
  COLOR_MEDIUM: 'nita_color_medium',
  COLOR_FULL: 'nita_color_full',
  COLOR_SOME: 'nita_color_some',
  COLOR_MOSTLY: 'nita_color_mostly',
} as const;

const SELECTION_BY_BUTTON_ID = new Map<string, ChatbotOptionSelection>([
  [V2_BOOKING_BUTTON_IDS.DIRECT_BOOKING, { stage: 'bookingIntent', value: 'DIRECT_BOOKING' }],
  [V2_BOOKING_BUTTON_IDS.ARTIST_CONTACT, { stage: 'bookingIntent', value: 'ARTIST_CONTACT' }],
  [WHATSAPP_BUTTON_IDS.FIRST_TATTOO_YES, { stage: 'firstTattoo', value: true }],
  [WHATSAPP_BUTTON_IDS.FIRST_TATTOO_NO, { stage: 'firstTattoo', value: false }],
  [WHATSAPP_BUTTON_IDS.SAME_SIZE_YES, { stage: 'sameSize', value: true }],
  [WHATSAPP_BUTTON_IDS.SAME_SIZE_NO, { stage: 'sameSize', value: false }],
  [WHATSAPP_BUTTON_IDS.COLOR_BLACK_ONLY, { stage: 'color', value: ColorDeclaration.BLACK_ONLY }],
  [WHATSAPP_BUTTON_IDS.COLOR_LOW, { stage: 'color', value: ColorDeclaration.LOW_COLOR }],
  [WHATSAPP_BUTTON_IDS.COLOR_MEDIUM, { stage: 'color', value: ColorDeclaration.MEDIUM_COLOR }],
  [WHATSAPP_BUTTON_IDS.COLOR_FULL, { stage: 'color', value: ColorDeclaration.FULL_COLOR }],
  [
    WHATSAPP_BUTTON_IDS.COLOR_SOME,
    { stage: 'color', value: ColorDeclaration.BLACK_WITH_SOME_COLOR },
  ],
  [WHATSAPP_BUTTON_IDS.COLOR_MOSTLY, { stage: 'color', value: ColorDeclaration.MOSTLY_COLOR }],
]);

export type WhatsAppInboundMessage =
  | { type: 'button_reply'; accountId: string; customerIdentifier: string; buttonId: string }
  | { type: 'text'; accountId: string; customerIdentifier: string; text: string }
  | { type: 'image'; accountId: string; customerIdentifier: string; image: ChatbotImageInput };

export type WhatsAppOutboundMessage =
  | { type: 'text'; text: string }
  | {
      type: 'interactive_list';
      body: string;
      button: string;
      rows: Array<{ id: string; title: string }>;
    }
  | {
      type: 'interactive_buttons';
      body: string;
      buttons: Array<{ id: string; title: string }>;
      headerImageUrl?: string;
    };

export interface WhatsAppCapabilities {
  interactiveButtons: boolean;
}

@Injectable()
export class WhatsAppAdapter {
  constructor(@Inject(ChatbotService) private readonly chatbotService: ChatbotService) {}

  resumePendingV2Analysis(accountId: string, customerIdentifier: string): Promise<void> {
    return this.chatbotService.resumePendingV2Analysis(accountId, customerIdentifier);
  }

  async handleIncoming(
    message: WhatsAppInboundMessage,
    capabilities: WhatsAppCapabilities = { interactiveButtons: true },
    durable?: DurableV2Input,
  ): Promise<WhatsAppOutboundMessage[]> {
    const response = await this.toChatbotResponse(message, durable);

    if (!response) {
      return [];
    }

    return this.toWhatsAppMessages(response, capabilities);
  }

  private toChatbotResponse(
    message: WhatsAppInboundMessage,
    durable?: DurableV2Input,
  ): Promise<ChatbotResponse | null> {
    switch (message.type) {
      case 'button_reply': {
        const selection = SELECTION_BY_BUTTON_ID.get(message.buttonId);

        if (!selection) {
          return Promise.resolve(null);
        }

        return this.chatbotService.processOptionSelection(
          message.accountId,
          message.customerIdentifier,
          selection,
          ...(durable ? [durable] : []),
        );
      }
      case 'image':
        return this.chatbotService.processImageMessage(
          message.accountId,
          message.customerIdentifier,
          message.image,
          ...(durable ? [durable] : []),
        );
      case 'text': {
        return this.chatbotService.processTextMessage(
          message.accountId,
          message.customerIdentifier,
          message.text,
          ...(durable ? [durable] : []),
        );
      }
    }
  }

  toWhatsAppMessages(
    response: ChatbotResponse,
    capabilities: WhatsAppCapabilities,
  ): WhatsAppOutboundMessage[] {
    if (response.options.length === 0) {
      return response.messages.map(({ text }) => ({ type: 'text', text }));
    }

    const prompt = response.messages.at(-1)?.text;

    if (!prompt) {
      return [];
    }

    const precedingMessages: WhatsAppOutboundMessage[] = response.messages
      .slice(0, -1)
      .map(({ text }) => ({ type: 'text', text }));

    if (!capabilities.interactiveButtons) {
      return [
        ...precedingMessages,
        {
          type: 'text',
          text: `${prompt}\n\n${response.options.map(({ label }) => `- ${label}`).join('\n')}`,
        },
      ];
    }

    if (response.state === ConversationState.ASK_COLOR && response.options.length === 4)
      return [
        ...precedingMessages,
        {
          type: 'interactive_list',
          body: prompt,
          button: 'Elegir color',
          rows: response.options.map((option) => this.toButton(response.state, option)),
        },
      ];

    return [
      ...precedingMessages,
      {
        type: 'interactive_buttons',
        body:
          response.state === ConversationState.ASK_COLOR
            ? `${prompt}\n\n${response.options.map(({ label }) => `- ${label}`).join('\n')}`
            : prompt,
        buttons: response.options.map((option) => this.toButton(response.state, option)),
      },
    ];
  }

  private toButton(state: ConversationState, option: ChatbotOption): { id: string; title: string } {
    if (state === ConversationState.ASK_FIRST_TATTOO || state === ConversationState.ASK_SAME_SIZE) {
      const id =
        option.value === 'YES'
          ? state === ConversationState.ASK_FIRST_TATTOO
            ? WHATSAPP_BUTTON_IDS.FIRST_TATTOO_YES
            : WHATSAPP_BUTTON_IDS.SAME_SIZE_YES
          : option.value === 'NO'
            ? state === ConversationState.ASK_FIRST_TATTOO
              ? WHATSAPP_BUTTON_IDS.FIRST_TATTOO_NO
              : WHATSAPP_BUTTON_IDS.SAME_SIZE_NO
            : undefined;
      if (id) return { id, title: option.label };
    }
    if (state === ConversationState.ASK_COLOR) {
      switch (option.value) {
        case ColorDeclaration.BLACK_ONLY:
          return { id: WHATSAPP_BUTTON_IDS.COLOR_BLACK_ONLY, title: option.label };
        case ColorDeclaration.LOW_COLOR:
          return { id: WHATSAPP_BUTTON_IDS.COLOR_LOW, title: option.label };
        case ColorDeclaration.MEDIUM_COLOR:
          return { id: WHATSAPP_BUTTON_IDS.COLOR_MEDIUM, title: option.label };
        case ColorDeclaration.FULL_COLOR:
          return { id: WHATSAPP_BUTTON_IDS.COLOR_FULL, title: option.label };
        case ColorDeclaration.BLACK_WITH_SOME_COLOR:
          return { id: WHATSAPP_BUTTON_IDS.COLOR_SOME, title: 'Negro + colores' };
        case ColorDeclaration.MOSTLY_COLOR:
          return { id: WHATSAPP_BUTTON_IDS.COLOR_MOSTLY, title: 'Mayormente color' };
      }
    }
    throw new BadRequestException('La respuesta contiene una opción no compatible con WhatsApp.');
  }
}

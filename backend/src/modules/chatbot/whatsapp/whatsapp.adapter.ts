import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ColorDeclaration,
  ConversationState,
  DetailLevel,
  TattooSize,
} from '../../../generated/prisma/client.js';
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
  SIZE_SMALL: 'nita_size_small',
  SIZE_MEDIUM: 'nita_size_medium',
  SIZE_LARGE: 'nita_size_large',
  DETAIL_LIGHT: 'nita_detail_light',
  DETAIL_MEDIUM: 'nita_detail_medium',
  DETAIL_DETAILED: 'nita_detail_detailed',
  FIRST_TATTOO_YES: 'nita_first_tattoo_yes',
  FIRST_TATTOO_NO: 'nita_first_tattoo_no',
  SAME_SIZE_YES: 'nita_same_size_yes',
  SAME_SIZE_NO: 'nita_same_size_no',
  COLOR_BLACK_ONLY: 'nita_color_black_only',
  COLOR_SOME: 'nita_color_some',
  COLOR_MOSTLY: 'nita_color_mostly',
} as const;

const LEGACY_AMBIGUOUS_MEDIUM_BUTTON_ID = 'nita_value_medium';

const SIZE_GUIDE_PUBLIC_PATH = '/nita-size-guide.png';
const DETAIL_GUIDE_PUBLIC_PATH = '/nita-detail-guide.png';

const GUIDE_PUBLIC_PATH_BY_STATE: Readonly<Partial<Record<ConversationState, string>>> = {
  [ConversationState.ASK_SIZE]: SIZE_GUIDE_PUBLIC_PATH,
  [ConversationState.ASK_DETAIL]: DETAIL_GUIDE_PUBLIC_PATH,
};

const SIZE_BUTTON_ID_BY_VALUE: Readonly<Record<TattooSize, string>> = {
  [TattooSize.SMALL]: WHATSAPP_BUTTON_IDS.SIZE_SMALL,
  [TattooSize.MEDIUM]: WHATSAPP_BUTTON_IDS.SIZE_MEDIUM,
  [TattooSize.LARGE]: WHATSAPP_BUTTON_IDS.SIZE_LARGE,
};

const DETAIL_BUTTON_ID_BY_VALUE: Readonly<Record<DetailLevel, string>> = {
  [DetailLevel.LIGHT]: WHATSAPP_BUTTON_IDS.DETAIL_LIGHT,
  [DetailLevel.MEDIUM]: WHATSAPP_BUTTON_IDS.DETAIL_MEDIUM,
  [DetailLevel.DETAILED]: WHATSAPP_BUTTON_IDS.DETAIL_DETAILED,
};

const SELECTION_BY_BUTTON_ID = new Map<string, ChatbotOptionSelection>([
  [V2_BOOKING_BUTTON_IDS.DIRECT_BOOKING, { stage: 'bookingIntent', value: 'DIRECT_BOOKING' }],
  [V2_BOOKING_BUTTON_IDS.ARTIST_CONTACT, { stage: 'bookingIntent', value: 'ARTIST_CONTACT' }],
  [WHATSAPP_BUTTON_IDS.SIZE_SMALL, { stage: 'size', value: TattooSize.SMALL }],
  [WHATSAPP_BUTTON_IDS.SIZE_MEDIUM, { stage: 'size', value: TattooSize.MEDIUM }],
  [WHATSAPP_BUTTON_IDS.SIZE_LARGE, { stage: 'size', value: TattooSize.LARGE }],
  [WHATSAPP_BUTTON_IDS.DETAIL_LIGHT, { stage: 'detail', value: DetailLevel.LIGHT }],
  [WHATSAPP_BUTTON_IDS.DETAIL_MEDIUM, { stage: 'detail', value: DetailLevel.MEDIUM }],
  [WHATSAPP_BUTTON_IDS.DETAIL_DETAILED, { stage: 'detail', value: DetailLevel.DETAILED }],
  [WHATSAPP_BUTTON_IDS.FIRST_TATTOO_YES, { stage: 'firstTattoo', value: true }],
  [WHATSAPP_BUTTON_IDS.FIRST_TATTOO_NO, { stage: 'firstTattoo', value: false }],
  [WHATSAPP_BUTTON_IDS.SAME_SIZE_YES, { stage: 'sameSize', value: true }],
  [WHATSAPP_BUTTON_IDS.SAME_SIZE_NO, { stage: 'sameSize', value: false }],
  [WHATSAPP_BUTTON_IDS.COLOR_BLACK_ONLY, { stage: 'color', value: ColorDeclaration.BLACK_ONLY }],
  [
    WHATSAPP_BUTTON_IDS.COLOR_SOME,
    { stage: 'color', value: ColorDeclaration.BLACK_WITH_SOME_COLOR },
  ],
  [WHATSAPP_BUTTON_IDS.COLOR_MOSTLY, { stage: 'color', value: ColorDeclaration.MOSTLY_COLOR }],
]);

const FALLBACK_SELECTION_BY_TEXT = new Map<string, ChatbotOptionSelection>([
  ['pequeño', { stage: 'size', value: TattooSize.SMALL }],
  ['mediano', { stage: 'size', value: TattooSize.MEDIUM }],
  ['grande', { stage: 'size', value: TattooSize.LARGE }],
  ['ligero', { stage: 'detail', value: DetailLevel.LIGHT }],
  ['medio', { stage: 'detail', value: DetailLevel.MEDIUM }],
  ['detallado', { stage: 'detail', value: DetailLevel.DETAILED }],
]);

export type WhatsAppInboundMessage =
  | { type: 'button_reply'; accountId: string; customerIdentifier: string; buttonId: string }
  | { type: 'text'; accountId: string; customerIdentifier: string; text: string }
  | { type: 'image'; accountId: string; customerIdentifier: string; image: ChatbotImageInput };

export type WhatsAppOutboundMessage =
  | { type: 'text'; text: string }
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
  constructor(
    @Inject(ChatbotService) private readonly chatbotService: ChatbotService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  resumePendingV2Analysis(accountId: string, customerIdentifier: string): Promise<void> {
    return this.chatbotService.resumePendingV2Analysis(accountId, customerIdentifier);
  }

  async handleIncoming(
    message: WhatsAppInboundMessage,
    capabilities: WhatsAppCapabilities = { interactiveButtons: true },
    durable?: DurableV2Input,
  ): Promise<WhatsAppOutboundMessage[]> {
    const response = await this.toChatbotResponse(message, capabilities, durable);

    if (!response) {
      return [];
    }

    return this.toWhatsAppMessages(response, capabilities);
  }

  private toChatbotResponse(
    message: WhatsAppInboundMessage,
    capabilities: WhatsAppCapabilities,
    durable?: DurableV2Input,
  ): Promise<ChatbotResponse | null> {
    switch (message.type) {
      case 'button_reply': {
        if (message.buttonId === LEGACY_AMBIGUOUS_MEDIUM_BUTTON_ID) {
          return Promise.resolve(null);
        }

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
        const fallbackSelection = capabilities.interactiveButtons
          ? undefined
          : FALLBACK_SELECTION_BY_TEXT.get(message.text.trim().toLowerCase());

        return fallbackSelection
          ? this.chatbotService.processOptionSelection(
              message.accountId,
              message.customerIdentifier,
              fallbackSelection,
              ...(durable ? [durable] : []),
            )
          : this.chatbotService.processTextMessage(
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
    const headerImageUrl = this.guideUrl(response.state);

    if (!capabilities.interactiveButtons) {
      return [
        ...precedingMessages,
        {
          type: 'text',
          text: `${prompt}\n\n${response.options.map(({ label }) => `- ${label}`).join('\n')}`,
        },
      ];
    }

    return [
      ...precedingMessages,
      {
        type: 'interactive_buttons',
        body:
          response.state === ConversationState.ASK_COLOR
            ? `${prompt}\n\n${response.options.map(({ label }) => `- ${label}`).join('\n')}`
            : prompt,
        buttons: response.options.map((option) => this.toButton(response.state, option)),
        ...(headerImageUrl ? { headerImageUrl } : {}),
      },
    ];
  }

  private guideUrl(state: ConversationState): string | undefined {
    const publicPath = GUIDE_PUBLIC_PATH_BY_STATE[state];
    const frontendUrl = this.config.get<string>('FRONTEND_URL')?.trim();

    if (!publicPath || !frontendUrl) {
      return undefined;
    }

    try {
      const url = new URL(publicPath, frontendUrl);

      if (url.protocol !== 'https:' || url.username || url.password) {
        return undefined;
      }

      return url.toString();
    } catch {
      return undefined;
    }
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
        case ColorDeclaration.BLACK_WITH_SOME_COLOR:
          return { id: WHATSAPP_BUTTON_IDS.COLOR_SOME, title: 'Negro + colores' };
        case ColorDeclaration.MOSTLY_COLOR:
          return { id: WHATSAPP_BUTTON_IDS.COLOR_MOSTLY, title: 'Mayormente color' };
      }
    }
    const id =
      state === ConversationState.ASK_SIZE
        ? SIZE_BUTTON_ID_BY_VALUE[option.value as TattooSize]
        : state === ConversationState.ASK_DETAIL
          ? DETAIL_BUTTON_ID_BY_VALUE[option.value as DetailLevel]
          : undefined;

    if (!id) {
      throw new BadRequestException('La respuesta contiene una opción no compatible con WhatsApp.');
    }

    return { id, title: option.label };
  }
}

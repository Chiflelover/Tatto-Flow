import { BadRequestException, Injectable } from '@nestjs/common';
import { DetailLevel, TattooSize } from '../../../generated/prisma/client.js';
import { ChatbotService } from '../chatbot.service.js';
import type {
  ChatbotImageInput,
  ChatbotOption,
  ChatbotResponse,
} from '../domain/chatbot.types.js';

export const WHATSAPP_BUTTON_IDS = {
  SMALL: 'nita_size_small',
  MEDIUM: 'nita_value_medium',
  LARGE: 'nita_size_large',
  LIGHT: 'nita_detail_light',
  DETAILED: 'nita_detail_detailed',
} as const;

const BUTTON_ID_BY_VALUE: Readonly<Record<string, string>> = {
  [TattooSize.SMALL]: WHATSAPP_BUTTON_IDS.SMALL,
  [TattooSize.MEDIUM]: WHATSAPP_BUTTON_IDS.MEDIUM,
  [TattooSize.LARGE]: WHATSAPP_BUTTON_IDS.LARGE,
  [DetailLevel.LIGHT]: WHATSAPP_BUTTON_IDS.LIGHT,
  [DetailLevel.DETAILED]: WHATSAPP_BUTTON_IDS.DETAILED,
};

const VALUE_BY_BUTTON_ID = new Map(
  Object.entries(BUTTON_ID_BY_VALUE).map(([value, buttonId]) => [buttonId, value]),
);

const FALLBACK_VALUE_BY_TEXT = new Map([
  ['pequeño', TattooSize.SMALL],
  ['mediano', TattooSize.MEDIUM],
  ['grande', TattooSize.LARGE],
  ['ligero', DetailLevel.LIGHT],
  ['medio', DetailLevel.MEDIUM],
  ['detallado', DetailLevel.DETAILED],
]);

export type WhatsAppInboundMessage =
  | { type: 'button_reply'; customerIdentifier: string; buttonId: string }
  | { type: 'text'; customerIdentifier: string; text: string }
  | { type: 'image'; customerIdentifier: string; image: ChatbotImageInput };

export type WhatsAppOutboundMessage =
  | { type: 'text'; text: string }
  | {
      type: 'interactive_buttons';
      body: string;
      buttons: Array<{ id: string; title: string }>;
    };

export interface WhatsAppCapabilities {
  interactiveButtons: boolean;
}

@Injectable()
export class WhatsAppAdapter {
  constructor(private readonly chatbotService: ChatbotService) {}

  async handleIncoming(
    message: WhatsAppInboundMessage,
    capabilities: WhatsAppCapabilities = { interactiveButtons: true },
  ): Promise<WhatsAppOutboundMessage[]> {
    const response = await this.toChatbotResponse(message, capabilities);

    return this.toWhatsAppMessages(response, capabilities);
  }

  private toChatbotResponse(
    message: WhatsAppInboundMessage,
    capabilities: WhatsAppCapabilities,
  ): Promise<ChatbotResponse> {
    switch (message.type) {
      case 'button_reply': {
        const value = VALUE_BY_BUTTON_ID.get(message.buttonId);

        if (!value) {
          throw new BadRequestException('La opción seleccionada ya no es válida.');
        }

        return this.chatbotService.processOptionSelection(message.customerIdentifier, value);
      }
      case 'image':
        return this.chatbotService.processImageMessage(message.customerIdentifier, message.image);
      case 'text': {
        const fallbackValue = capabilities.interactiveButtons
          ? undefined
          : FALLBACK_VALUE_BY_TEXT.get(message.text.trim().toLowerCase());

        return fallbackValue
          ? this.chatbotService.processOptionSelection(message.customerIdentifier, fallbackValue)
          : this.chatbotService.processTextMessage(message.customerIdentifier, message.text);
      }
    }
  }

  private toWhatsAppMessages(
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

    return [
      ...precedingMessages,
      {
        type: 'interactive_buttons',
        body: prompt,
        buttons: response.options.map((option) => this.toButton(option)),
      },
    ];
  }

  private toButton(option: ChatbotOption): { id: string; title: string } {
    const id = BUTTON_ID_BY_VALUE[option.value];

    if (!id) {
      throw new BadRequestException('La respuesta contiene una opción no compatible con WhatsApp.');
    }

    return { id, title: option.label };
  }
}

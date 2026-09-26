import { Injectable } from '@nestjs/common';
import { ConversationState, DetailLevel, TattooSize } from '../../../generated/prisma/client.js';
import type {
  ChatbotDecision,
  ChatbotInput,
  ChatbotOption,
  ChatbotResponse,
  ConversationContext,
} from './chatbot.types.js';

const WELCOME_MESSAGE =
  'Hola, soy Nita, la secretaria virtual. Te haré unas preguntas rápidas para conocer mejor tu idea y poder atenderte.';
const SIZE_QUESTION =
  '¿Qué tamaño aproximado tendrá tu tatuaje?\n\n(Las imágenes son solo ejemplos para comparar tamaños)';
const DETAIL_QUESTION =
  '¿Qué nivel de detalle buscas para tu tatuaje?\n\n(Piensa en cuánto detalle, líneas, sombras y tinta quieres que tenga.)';
const BODY_PART_QUESTION = '¿En qué parte del cuerpo te gustaría hacerte el tatuaje?';
const IMAGE_QUESTION =
  'Perfecto. Ahora envíame una imagen de referencia del tatuaje que tienes en mente.\n\nNo tiene que ser exactamente el mismo diseño. Lo ideal es que sea un tatuaje ya hecho sobre la piel, parecido a lo que buscas en tamaño y nivel de detalle.\n\n(Puede ser un tatuaje que hayas encontrado en Instagram, Pinterest o cualquier otra referencia.)';

const SIZE_OPTIONS: ChatbotOption[] = [
  { value: TattooSize.SMALL, label: 'Pequeño' },
  { value: TattooSize.MEDIUM, label: 'Mediano' },
  { value: TattooSize.LARGE, label: 'Grande' },
];

const DETAIL_OPTIONS: ChatbotOption[] = [
  { value: DetailLevel.LIGHT, label: 'Ligero' },
  { value: DetailLevel.MEDIUM, label: 'Medio' },
  { value: DetailLevel.DETAILED, label: 'Detallado' },
];

const VALID_SIZES = new Set<string>(Object.values(TattooSize));
const VALID_DETAILS = new Set<string>(Object.values(DetailLevel));
const VALID_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

@Injectable()
export class NitaStateMachine {
  begin(): ChatbotDecision {
    return {
      update: { currentState: ConversationState.ASK_SIZE },
      response: this.createResponse(
        ConversationState.ASK_SIZE,
        [WELCOME_MESSAGE, SIZE_QUESTION],
        SIZE_OPTIONS,
      ),
    };
  }

  process(context: ConversationContext, input: ChatbotInput): ChatbotDecision {
    if (context.currentState === ConversationState.START) {
      return this.begin();
    }

    switch (context.currentState) {
      case ConversationState.ASK_SIZE:
        return this.processSize(input);
      case ConversationState.ASK_DETAIL:
        return this.processDetail(input);
      case ConversationState.ASK_BODY_PART:
        return this.processBodyPart(input);
      case ConversationState.WAITING_IMAGE:
        return this.processImage(input);
      case ConversationState.ANALYZING:
        return this.unchanged(ConversationState.ANALYZING, 'Analizando referencia...');
      case ConversationState.VALIDATING:
        return this.unchanged(
          ConversationState.VALIDATING,
          'Estoy validando la información de tu cotización.',
        );
      case ConversationState.HANDOFF_TO_TATTOO_ARTIST:
        return this.unchanged(
          ConversationState.HANDOFF_TO_TATTOO_ARTIST,
          'Un tatuador continuará personalmente esta conversación.',
        );
    }
  }

  prompt(context: ConversationContext): ChatbotResponse {
    switch (context.currentState) {
      case ConversationState.START:
        return this.begin().response;
      case ConversationState.ASK_SIZE:
        return this.createResponse(ConversationState.ASK_SIZE, [SIZE_QUESTION], SIZE_OPTIONS);
      case ConversationState.ASK_DETAIL:
        return this.createResponse(ConversationState.ASK_DETAIL, [DETAIL_QUESTION], DETAIL_OPTIONS);
      case ConversationState.ASK_BODY_PART:
        return this.createResponse(ConversationState.ASK_BODY_PART, [BODY_PART_QUESTION]);
      case ConversationState.WAITING_IMAGE:
        return this.createResponse(ConversationState.WAITING_IMAGE, [IMAGE_QUESTION]);
      case ConversationState.ANALYZING:
        return this.createResponse(ConversationState.ANALYZING, ['Analizando referencia...']);
      case ConversationState.VALIDATING:
        return this.createResponse(ConversationState.VALIDATING, [
          'Estoy validando la información de tu cotización.',
        ]);
      case ConversationState.HANDOFF_TO_TATTOO_ARTIST:
        return this.createResponse(ConversationState.HANDOFF_TO_TATTOO_ARTIST, [
          'Un tatuador continuará personalmente esta conversación.',
        ]);
    }
  }

  private processSize(input: ChatbotInput): ChatbotDecision {
    if (input.type !== 'option' || !VALID_SIZES.has(input.value)) {
      return {
        update: {},
        response: this.createResponse(
          ConversationState.ASK_SIZE,
          ['No pude reconocer ese tamaño. Elige una de las opciones disponibles.', SIZE_QUESTION],
          SIZE_OPTIONS,
        ),
      };
    }

    return {
      update: {
        selectedSize: input.value as TattooSize,
        currentState: ConversationState.ASK_DETAIL,
      },
      response: this.createResponse(
        ConversationState.ASK_DETAIL,
        [DETAIL_QUESTION],
        DETAIL_OPTIONS,
      ),
    };
  }

  private processDetail(input: ChatbotInput): ChatbotDecision {
    if (input.type !== 'option' || !VALID_DETAILS.has(input.value)) {
      return {
        update: {},
        response: this.createResponse(
          ConversationState.ASK_DETAIL,
          ['No pude reconocer ese nivel de detalle. Elige una de las opciones.', DETAIL_QUESTION],
          DETAIL_OPTIONS,
        ),
      };
    }

    return {
      update: {
        selectedDetail: input.value as DetailLevel,
        currentState: ConversationState.ASK_BODY_PART,
      },
      response: this.createResponse(ConversationState.ASK_BODY_PART, [BODY_PART_QUESTION]),
    };
  }

  private processBodyPart(input: ChatbotInput): ChatbotDecision {
    if (input.type === 'option') {
      return this.ignored(ConversationState.ASK_BODY_PART);
    }

    if (input.type !== 'text') {
      return this.unchanged(
        ConversationState.ASK_BODY_PART,
        'Escribe la zona del cuerpo para poder continuar.',
        BODY_PART_QUESTION,
      );
    }

    const bodyPart = input.value.trim();

    if (!bodyPart) {
      return this.unchanged(
        ConversationState.ASK_BODY_PART,
        'La zona no puede estar vacía. Por favor, inténtalo nuevamente.',
        BODY_PART_QUESTION,
      );
    }

    if (bodyPart.length > 10) {
      return this.unchanged(
        ConversationState.ASK_BODY_PART,
        'La zona debe tener máximo 10 caracteres. Por favor, inténtalo nuevamente.',
      );
    }

    return {
      update: {
        bodyPart,
        currentState: ConversationState.WAITING_IMAGE,
      },
      response: this.createResponse(ConversationState.WAITING_IMAGE, [IMAGE_QUESTION]),
    };
  }

  private processImage(input: ChatbotInput): ChatbotDecision {
    if (input.type !== 'image') {
      return this.unchanged(
        ConversationState.WAITING_IMAGE,
        'Necesito que envíes una imagen de referencia para continuar.',
        IMAGE_QUESTION,
      );
    }

    if (!VALID_IMAGE_MIME_TYPES.has(input.image.mimeType.toLowerCase())) {
      return this.unchanged(
        ConversationState.WAITING_IMAGE,
        'La referencia debe ser una imagen JPG, PNG o WebP válida.',
        IMAGE_QUESTION,
      );
    }

    return {
      update: { currentState: ConversationState.ANALYZING },
      response: this.createResponse(ConversationState.ANALYZING, ['Analizando referencia...']),
    };
  }

  private unchanged(state: ConversationState, ...messages: [string, ...string[]]): ChatbotDecision {
    return {
      update: {},
      response: this.createResponse(state, messages),
    };
  }

  private ignored(state: ConversationState): ChatbotDecision {
    return {
      ignored: true,
      update: {},
      response: this.createResponse(state, []),
    };
  }

  private createResponse(
    state: ConversationState,
    messages: string[],
    options: ChatbotOption[] = [],
  ): ChatbotResponse {
    return {
      messages: messages.map((text) => ({ type: 'text', text })),
      options,
      state,
    };
  }
}

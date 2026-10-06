import { Injectable } from '@nestjs/common';
import { ColorDeclaration, ConversationState } from '../../../generated/prisma/client.js';
import { V2_TARGET_SIZE_AFTER_ANALYSIS_QUESTION } from './nita-v2-messages.js';
import { isExplicitColorDeclaration } from './nita-v2-color.js';
import type {
  ChatbotDecision,
  ChatbotInput,
  ChatbotOption,
  ChatbotResponse,
  ConversationContext,
} from './chatbot.types.js';

const FIRST_QUESTION = '¿Este es tu primer tatuaje?';
const IMAGE_QUESTION =
  'Envíame una imagen de referencia del tatuaje que tienes en mente.\n\nSi tienes una foto del tatuaje sobre piel, mejor.';
const SAME_SIZE_QUESTION =
  '¿El tatuaje que te vas a hacer tendrá el mismo tamaño que la referencia?';
const SIZE_QUESTION =
  '¿Aproximadamente cuánto quieres que ocupe el tatuaje en tu cuerpo?\n\nPuedes indicarme una medida aproximada, por ejemplo: 8 cm. No tiene que ser exacta.';
const COLOR_QUESTION = '¿Qué nivel de color quieres para tu tatuaje?';
const PLACEMENT_QUESTION = '¿En qué parte del cuerpo quieres hacerte el tatuaje?';

const YES_NO: ChatbotOption[] = [
  { value: 'YES', label: 'Sí' },
  { value: 'NO', label: 'No' },
];
export const V2_COLOR_OPTIONS: ChatbotOption[] = [
  { value: ColorDeclaration.BLACK_ONLY, label: 'Negro' },
  { value: ColorDeclaration.LOW_COLOR, label: 'Poco color' },
  { value: ColorDeclaration.MEDIUM_COLOR, label: 'Color medio' },
  { value: ColorDeclaration.FULL_COLOR, label: 'Full color' },
];

const PROMPTS: Partial<Record<ConversationState, string>> = {
  ASK_FIRST_TATTOO: FIRST_QUESTION,
  WAITING_IMAGE: IMAGE_QUESTION,
  ASK_SAME_SIZE: SAME_SIZE_QUESTION,
  ASK_DESIRED_SIZE_CM: SIZE_QUESTION,
  ASK_TARGET_SIZE_AFTER_ANALYSIS: V2_TARGET_SIZE_AFTER_ANALYSIS_QUESTION,
  ASK_COLOR: COLOR_QUESTION,
  ASK_BODY_PART: PLACEMENT_QUESTION,
};

function normalizedText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

function textColor(value: string): ColorDeclaration | undefined {
  switch (normalizedText(value)) {
    case 'negro':
    case 'solo negro':
    case 'black & grey':
    case 'black and grey':
    case 'negro y gris':
      return ColorDeclaration.BLACK_ONLY;
    case 'poco color':
      return ColorDeclaration.LOW_COLOR;
    case 'color medio':
      return ColorDeclaration.MEDIUM_COLOR;
    case 'full color':
      return ColorDeclaration.FULL_COLOR;
    case 'negro con algunos colores':
      return ColorDeclaration.BLACK_WITH_SOME_COLOR;
    case 'principalmente a color':
      return ColorDeclaration.MOSTLY_COLOR;
    default:
      return undefined;
  }
}

export function parseTargetSizeCm(value: string): number | null {
  const match = /^(\d+(?:\.\d+)?)\s*(?:cm)?$/i.exec(value.trim());
  if (!match) return null;
  const size = Number(match[1]);
  return Number.isFinite(size) && size > 0 ? size : null;
}

@Injectable()
export class NitaV2StateMachine {
  begin(): ChatbotDecision {
    return {
      update: { currentState: ConversationState.ASK_FIRST_TATTOO },
      response: this.response(ConversationState.ASK_FIRST_TATTOO, [
        'Hola, soy Nita. Te haré unas preguntas para conocer tu idea.',
        FIRST_QUESTION,
      ]),
    };
  }

  prompt(context: ConversationContext): ChatbotResponse {
    if (context.currentState === ConversationState.START) return this.begin().response;
    const question = PROMPTS[context.currentState];
    return this.response(context.currentState, question ? [question] : []);
  }

  process(context: ConversationContext, input: ChatbotInput): ChatbotDecision {
    const state = context.currentState;
    // A delayed button must never answer the next question, including at START.
    if (input.type === 'option') {
      const expectedStage =
        state === ConversationState.ASK_FIRST_TATTOO
          ? 'firstTattoo'
          : state === ConversationState.ASK_SAME_SIZE
            ? 'sameSize'
            : state === ConversationState.ASK_COLOR
              ? 'color'
              : undefined;
      if (input.stage !== expectedStage) return this.ignored(state);
    }
    if (state === ConversationState.START) {
      return input.type === 'image' ? this.ignored(state) : this.begin();
    }
    if (input.type === 'image' && state !== ConversationState.WAITING_IMAGE) {
      if (state === ConversationState.READY_FOR_ANALYSIS) return this.ignored(state);
      return { update: {}, response: this.prompt(context) };
    }

    switch (state) {
      case ConversationState.ASK_FIRST_TATTOO:
      case ConversationState.ASK_SAME_SIZE: {
        const answer =
          input.type === 'option' && (input.stage === 'firstTattoo' || input.stage === 'sameSize')
            ? input.value
            : input.type === 'text' && normalizedText(input.value) === 'si'
              ? true
              : input.type === 'text' && normalizedText(input.value) === 'no'
                ? false
                : undefined;
        if (typeof answer !== 'boolean')
          return this.retry(context, 'Elige Sí o No para continuar.');
        const next =
          state === ConversationState.ASK_FIRST_TATTOO
            ? ConversationState.WAITING_IMAGE
            : ConversationState.ASK_DESIRED_SIZE_CM;
        return {
          update:
            state === ConversationState.ASK_FIRST_TATTOO
              ? { firstTattoo: answer, currentState: next }
              : { sameSizeAsReference: answer, targetSizeCm: null, currentState: next },
          response: this.response(next, [PROMPTS[next]!]),
        };
      }
      case ConversationState.WAITING_IMAGE:
        if (input.type !== 'image')
          return this.retry(
            context,
            'Necesito que envíes una imagen de referencia para continuar.',
          );
        if (
          !['image/jpeg', 'image/png', 'image/webp'].includes(input.image.mimeType.toLowerCase())
        ) {
          return this.retry(context, 'La referencia debe ser una imagen JPG, PNG o WebP válida.');
        }
        // The service only commits this transition after private storage succeeds.
        return {
          update: { currentState: ConversationState.ASK_SAME_SIZE },
          response: this.response(ConversationState.ASK_SAME_SIZE, [SAME_SIZE_QUESTION]),
        };
      case ConversationState.ASK_DESIRED_SIZE_CM:
      case ConversationState.ASK_TARGET_SIZE_AFTER_ANALYSIS: {
        const size = input.type === 'text' ? parseTargetSizeCm(input.value) : null;
        if (size === null)
          return this.retry(
            context,
            'Indícame una medida aproximada en centímetros, por ejemplo: 8 cm.',
          );
        const afterAnalysis = state === ConversationState.ASK_TARGET_SIZE_AFTER_ANALYSIS;
        const next = afterAnalysis
          ? ConversationState.READY_FOR_ANALYSIS
          : ConversationState.ASK_COLOR;
        return {
          update: { targetSizeCm: size, currentState: next },
          response: this.response(next, [
            afterAnalysis ? 'Gracias. Guardé el tamaño que deseas.' : COLOR_QUESTION,
          ]),
        };
      }
      case ConversationState.ASK_COLOR: {
        const color =
          input.type === 'option' && input.stage === 'color'
            ? input.value
            : input.type === 'text'
              ? textColor(input.value)
              : undefined;
        if (!isExplicitColorDeclaration(color))
          return this.retry(context, 'Elige una de las opciones de color.');
        return {
          update: { colorDeclaration: color, currentState: ConversationState.ASK_BODY_PART },
          response: this.response(ConversationState.ASK_BODY_PART, [PLACEMENT_QUESTION]),
        };
      }
      case ConversationState.ASK_BODY_PART: {
        if (input.type !== 'text')
          return this.retry(context, 'Escribe la parte del cuerpo para continuar.');
        // Recognizable late answers cannot become a placement.
        if (textColor(input.value) || ['si', 'no'].includes(normalizedText(input.value)))
          return this.retry(context, PLACEMENT_QUESTION);
        const placement = input.value.trim();
        if (!placement || placement.length > 120)
          return this.retry(context, 'Indica una ubicación de entre 1 y 120 caracteres.');
        return {
          update: { bodyPart: placement, currentState: ConversationState.READY_FOR_ANALYSIS },
          response: this.response(ConversationState.READY_FOR_ANALYSIS, [
            'Gracias. Guardé tus respuestas y tu referencia.',
          ]),
        };
      }
      default:
        return this.ignored(state);
    }
  }

  private retry(context: ConversationContext, message: string): ChatbotDecision {
    const question = PROMPTS[context.currentState];
    return {
      update: {},
      response: this.response(
        context.currentState,
        question && message !== question ? [message, question] : [message],
      ),
    };
  }

  private ignored(state: ConversationState): ChatbotDecision {
    return { ignored: true, update: {}, response: this.response(state, []) };
  }

  private response(state: ConversationState, messages: string[]): ChatbotResponse {
    return {
      state,
      messages: messages.map((text) => ({ type: 'text', text })),
      options:
        state === ConversationState.ASK_FIRST_TATTOO || state === ConversationState.ASK_SAME_SIZE
          ? YES_NO
          : state === ConversationState.ASK_COLOR
            ? V2_COLOR_OPTIONS
            : [],
    };
  }
}

import type {
  Conversation,
  BookingIntent,
  ConversationState,
  ColorDeclaration,
  Prisma,
} from '../../../generated/prisma/client.js';
import type { TattooImageInput } from '../../image-analysis/domain/image-analysis.types.js';

export interface ChatbotMessage {
  type: 'text';
  text: string;
}

export interface ChatbotOption {
  value: string;
  label: string;
}

export interface ChatbotResponse {
  messages: ChatbotMessage[];
  options: ChatbotOption[];
  state: ConversationState;
}

export interface DurableV2Input {
  checkpoint(
    tx: Prisma.TransactionClient,
    conversation: Conversation,
    response: ChatbotResponse,
  ): Promise<void>;
}

export type ChatbotImageInput = TattooImageInput;

export type ChatbotOptionSelection =
  | { stage: 'firstTattoo'; value: boolean }
  | { stage: 'sameSize'; value: boolean }
  | { stage: 'color'; value: ColorDeclaration }
  | { stage: 'bookingIntent'; value: BookingIntent };

export type ChatbotInput =
  | ({ type: 'option' } & ChatbotOptionSelection)
  | { type: 'text'; value: string }
  | { type: 'image'; image: ChatbotImageInput };

export type ConversationContext = Pick<Conversation, 'currentState' | 'bodyPart'> &
  Partial<
    Pick<Conversation, 'firstTattoo' | 'sameSizeAsReference' | 'targetSizeCm' | 'colorDeclaration'>
  >;

export interface ChatbotConversationUpdate {
  currentState?: ConversationState;
  bodyPart?: string;
  firstTattoo?: boolean;
  sameSizeAsReference?: boolean;
  targetSizeCm?: number | null;
  colorDeclaration?: ColorDeclaration;
}

export interface ChatbotDecision {
  response: ChatbotResponse;
  update: ChatbotConversationUpdate;
  ignored?: boolean;
}

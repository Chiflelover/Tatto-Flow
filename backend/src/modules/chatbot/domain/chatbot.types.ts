import type {
  Conversation,
  BookingIntent,
  ConversationState,
  ColorDeclaration,
  DetailLevel,
  LeadStatus,
  ReviewReason,
  TattooSize,
  Prisma,
} from '../../../generated/prisma/client.js';
import type {
  ImageAnalysisResult,
  TattooImageInput,
} from '../../image-analysis/domain/image-analysis.types.js';
import type { QuotationPricingSnapshot } from '../../image-analysis/image-analysis-workflow.service.js';

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
  development?: {
    imageAnalysis: ImageAnalysisResult | null;
    quotation: {
      status: LeadStatus;
      reviewReasons: ReviewReason[];
      pricingRule: QuotationPricingSnapshot | null;
    };
  };
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
  | { stage: 'size'; value: TattooSize }
  | { stage: 'detail'; value: DetailLevel }
  | { stage: 'firstTattoo'; value: boolean }
  | { stage: 'sameSize'; value: boolean }
  | { stage: 'color'; value: ColorDeclaration }
  | { stage: 'bookingIntent'; value: BookingIntent };

export type ChatbotInput =
  | ({ type: 'option' } & ChatbotOptionSelection)
  | { type: 'text'; value: string }
  | { type: 'image'; image: ChatbotImageInput };

export type ConversationContext = Pick<
  Conversation,
  'currentState' | 'selectedSize' | 'selectedDetail' | 'bodyPart'
> &
  Partial<
    Pick<
      Conversation,
      'flowVersion' | 'firstTattoo' | 'sameSizeAsReference' | 'targetSizeCm' | 'colorDeclaration'
    >
  >;

export interface ChatbotConversationUpdate {
  currentState?: ConversationState;
  selectedSize?: TattooSize;
  selectedDetail?: DetailLevel;
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

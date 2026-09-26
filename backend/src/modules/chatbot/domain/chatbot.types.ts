import type {
  Conversation,
  ConversationState,
  DetailLevel,
  LeadStatus,
  ReviewReason,
  TattooSize,
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

export type ChatbotImageInput = TattooImageInput;

export type ChatbotInput =
  | { type: 'option'; value: string }
  | { type: 'text'; value: string }
  | { type: 'image'; image: ChatbotImageInput };

export type ConversationContext = Pick<
  Conversation,
  'currentState' | 'selectedSize' | 'selectedDetail' | 'bodyPart'
>;

export interface ChatbotConversationUpdate {
  currentState?: ConversationState;
  selectedSize?: TattooSize;
  selectedDetail?: DetailLevel;
  bodyPart?: string;
}

export interface ChatbotDecision {
  response: ChatbotResponse;
  update: ChatbotConversationUpdate;
  ignored?: boolean;
}

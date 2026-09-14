export interface PriceMessageInput {
  phoneNumber: string;
  message: string;
  idempotencyKey: string;
}

export abstract class CustomerMessagingService {
  abstract sendPrice(input: PriceMessageInput): Promise<void>;
}

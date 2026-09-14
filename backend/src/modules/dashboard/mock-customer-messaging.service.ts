import { Injectable } from '@nestjs/common';
import { CustomerMessagingService, type PriceMessageInput } from './customer-messaging.service.js';

@Injectable()
export class MockCustomerMessagingService extends CustomerMessagingService {
  sendPrice(input: PriceMessageInput): Promise<void> {
    void input;
    return Promise.resolve();
  }
}

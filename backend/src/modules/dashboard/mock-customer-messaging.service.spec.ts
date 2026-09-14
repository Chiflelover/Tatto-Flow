import { MockCustomerMessagingService } from './mock-customer-messaging.service.js';

describe('MockCustomerMessagingService', () => {
  it('simulates a price delivery without contacting an external provider', async () => {
    const service = new MockCustomerMessagingService();

    await expect(
      service.sendPrice({
        phoneNumber: '+51999999999',
        message: 'Mensaje de prueba',
        idempotencyKey: 'lead:test:price',
      }),
    ).resolves.toBeUndefined();
  });
});

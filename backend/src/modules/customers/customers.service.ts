import { Inject, Injectable } from '@nestjs/common';
import type { Customer } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';

@Injectable()
export class CustomersService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findOrCreateByPhoneNumber(phoneNumber: string): Promise<Customer> {
    const normalizedPhoneNumber = phoneNumber.trim();

    if (!normalizedPhoneNumber) {
      throw new Error('Customer identifier cannot be empty.');
    }

    return this.prisma.customer.upsert({
      where: { phoneNumber: normalizedPhoneNumber },
      update: {},
      create: { phoneNumber: normalizedPhoneNumber },
    });
  }

  async claimOutOfHoursNotice(customerId: string, closedPeriodKey: string): Promise<boolean> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(closedPeriodKey)) {
      throw new Error('Closed period key must use YYYY-MM-DD.');
    }

    const result = await this.prisma.customer.updateMany({
      where: {
        id: customerId,
        OR: [
          { lastOutOfHoursNoticeKey: null },
          { lastOutOfHoursNoticeKey: { not: closedPeriodKey } },
        ],
      },
      data: { lastOutOfHoursNoticeKey: closedPeriodKey },
    });

    return result.count === 1;
  }
}

import { Injectable } from '@nestjs/common';
import type { Customer } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

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
}

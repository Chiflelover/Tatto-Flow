import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';

@Injectable()
export class WhatsAppInboundMessageRepository {
  constructor(private readonly prisma: PrismaService) {}

  async claim(messageId: string): Promise<boolean> {
    this.assertValidMessageId(messageId);
    const inserted = await this.prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO "whatsapp_inbound_messages" ("message_id")
        VALUES (${messageId})
        ON CONFLICT ("message_id") DO NOTHING
      `,
    );

    return inserted === 1;
  }

  async release(messageId: string): Promise<void> {
    this.assertValidMessageId(messageId);
    await this.prisma.$executeRaw(
      Prisma.sql`
        DELETE FROM "whatsapp_inbound_messages"
        WHERE "message_id" = ${messageId}
      `,
    );
  }

  private assertValidMessageId(messageId: string): void {
    if (!messageId || messageId.length > 255) {
      throw new BadRequestException('El mensaje de WhatsApp no contiene un ID válido.');
    }
  }
}

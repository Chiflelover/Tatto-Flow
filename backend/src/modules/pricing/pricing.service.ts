import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  type DetailLevel,
  type PricingRule,
  type TattooSize,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';

type PricingClient = Pick<Prisma.TransactionClient, 'pricingRule'>;

export interface PricingRulePriceUpdate {
  pricingRuleId: string;
  minPrice: number;
  maxPrice: number;
}

const MAX_PRICE = 99_999_999.99;

@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  listActiveRules(client: PricingClient = this.prisma): Promise<PricingRule[]> {
    return client.pricingRule.findMany({
      where: { isActive: true },
      orderBy: [{ detail: 'asc' }, { size: 'asc' }],
    });
  }

  findActiveRule(
    selectedSize: TattooSize,
    selectedDetail: DetailLevel,
    client: PricingClient = this.prisma,
  ): Promise<PricingRule | null> {
    return client.pricingRule.findFirst({
      where: {
        size: selectedSize,
        detail: selectedDetail,
        isActive: true,
      },
    });
  }

  async updateActiveRules(updates: PricingRulePriceUpdate[], changedByUserId: string) {
    this.validateUpdates(updates);

    return this.prisma.$transaction(
      async (transaction) => {
        const ruleIds = updates.map((update) => update.pricingRuleId);
        const currentRules = await transaction.pricingRule.findMany({
          where: {
            id: { in: ruleIds },
            isActive: true,
          },
        });

        if (currentRules.length !== ruleIds.length) {
          throw new NotFoundException('Una o más reglas de precios ya no están disponibles.');
        }

        const rulesById = new Map(currentRules.map((rule) => [rule.id, rule]));
        let updatedCount = 0;

        for (const update of updates) {
          const currentRule = rulesById.get(update.pricingRuleId);

          if (!currentRule) {
            throw new NotFoundException('Una o más reglas de precios ya no están disponibles.');
          }

          const newMinPrice = new Prisma.Decimal(update.minPrice);
          const newMaxPrice = new Prisma.Decimal(update.maxPrice);

          if (
            currentRule.minPrice.equals(newMinPrice) &&
            currentRule.maxPrice.equals(newMaxPrice)
          ) {
            continue;
          }

          await transaction.pricingRule.update({
            where: { id: currentRule.id },
            data: {
              minPrice: newMinPrice,
              maxPrice: newMaxPrice,
              version: { increment: 1 },
            },
          });
          await transaction.pricingRuleHistory.create({
            data: {
              pricingRuleId: currentRule.id,
              oldMinPrice: currentRule.minPrice,
              oldMaxPrice: currentRule.maxPrice,
              newMinPrice,
              newMaxPrice,
              changedByUserId,
            },
          });
          updatedCount += 1;
        }

        return {
          rules: await this.listActiveRules(transaction),
          updatedCount,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private validateUpdates(updates: PricingRulePriceUpdate[]): void {
    if (updates.length < 1 || updates.length > 9) {
      throw new BadRequestException('Debes enviar entre 1 y 9 reglas de precios.');
    }

    const uniqueRuleIds = new Set(updates.map((update) => update.pricingRuleId));

    if (uniqueRuleIds.size !== updates.length) {
      throw new BadRequestException('No puedes modificar la misma regla más de una vez.');
    }

    for (const update of updates) {
      const values = [update.minPrice, update.maxPrice];
      const hasInvalidValue = values.some(
        (value) =>
          !Number.isFinite(value) ||
          value < 0 ||
          value > MAX_PRICE ||
          new Prisma.Decimal(value).decimalPlaces() > 2,
      );

      if (hasInvalidValue) {
        throw new BadRequestException(
          'Los precios deben ser números válidos, positivos y con máximo dos decimales.',
        );
      }

      if (update.maxPrice < update.minPrice) {
        throw new BadRequestException('El precio máximo debe ser igual o mayor al precio mínimo.');
      }
    }
  }
}

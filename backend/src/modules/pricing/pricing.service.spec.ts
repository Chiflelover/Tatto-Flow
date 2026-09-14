import { BadRequestException } from '@nestjs/common';
import { initialPricingRules } from '../../../prisma/pricing-rules.seed-data.js';
import {
  DetailLevel,
  Prisma,
  TattooSize,
  type PricingRule,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { PricingService } from './pricing.service.js';

const USER_ID = 'bb8bf7d2-e17c-44da-b456-b7240d30daf2';

interface HistoryEntry {
  pricingRuleId: string;
  oldMinPrice: Prisma.Decimal;
  oldMaxPrice: Prisma.Decimal;
  newMinPrice: Prisma.Decimal;
  newMaxPrice: Prisma.Decimal;
  changedByUserId: string;
}

function cloneRule(rule: PricingRule): PricingRule {
  return {
    ...rule,
    minPrice: new Prisma.Decimal(rule.minPrice),
    maxPrice: new Prisma.Decimal(rule.maxPrice),
    updatedAt: new Date(rule.updatedAt),
  };
}

function createFixture(failOnRuleId?: string) {
  const now = new Date('2026-09-14T12:00:00.000Z');
  let rules: PricingRule[] = initialPricingRules.map((rule, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    size: rule.size,
    detail: rule.detail,
    minPrice: new Prisma.Decimal(rule.minPrice),
    maxPrice: new Prisma.Decimal(rule.maxPrice),
    isActive: true,
    version: 1,
    updatedAt: now,
  }));
  const history: HistoryEntry[] = [];

  const findMany = vi.fn(
    (arguments_: { where?: { isActive?: boolean; id?: { in: string[] } }; orderBy?: object[] }) => {
      const ids = arguments_.where?.id?.in;
      const matches = rules.filter(
        (rule) =>
          (!ids || ids.includes(rule.id)) &&
          (arguments_.where?.isActive === undefined || rule.isActive === arguments_.where.isActive),
      );

      return Promise.resolve(matches.map(cloneRule));
    },
  );
  const findFirst = vi.fn(
    (arguments_: { where: { size: TattooSize; detail: DetailLevel; isActive: boolean } }) =>
      Promise.resolve(
        rules.find(
          (rule) =>
            rule.size === arguments_.where.size &&
            rule.detail === arguments_.where.detail &&
            rule.isActive === arguments_.where.isActive,
        ) ?? null,
      ).then((rule) => (rule ? cloneRule(rule) : null)),
  );
  const update = vi.fn(
    (arguments_: {
      where: { id: string };
      data: {
        minPrice: Prisma.Decimal;
        maxPrice: Prisma.Decimal;
        version: { increment: number };
      };
    }) => {
      if (arguments_.where.id === failOnRuleId) {
        return Promise.reject(new Error('simulated update failure'));
      }

      const index = rules.findIndex((rule) => rule.id === arguments_.where.id);
      const current = rules[index];

      if (!current) {
        return Promise.reject(new Error('rule not found'));
      }

      const updated: PricingRule = {
        ...current,
        minPrice: new Prisma.Decimal(arguments_.data.minPrice),
        maxPrice: new Prisma.Decimal(arguments_.data.maxPrice),
        version: current.version + arguments_.data.version.increment,
      };
      rules[index] = updated;

      return Promise.resolve(cloneRule(updated));
    },
  );
  const createHistory = vi.fn((arguments_: { data: HistoryEntry }) => {
    history.push({
      ...arguments_.data,
      oldMinPrice: new Prisma.Decimal(arguments_.data.oldMinPrice),
      oldMaxPrice: new Prisma.Decimal(arguments_.data.oldMaxPrice),
      newMinPrice: new Prisma.Decimal(arguments_.data.newMinPrice),
      newMaxPrice: new Prisma.Decimal(arguments_.data.newMaxPrice),
    });
    return Promise.resolve({ id: `history-${history.length}` });
  });
  const transactionClient = {
    pricingRule: { findMany, findFirst, update },
    pricingRuleHistory: { create: createHistory },
  };
  const runTransaction = vi.fn(
    async (callback: (client: typeof transactionClient) => Promise<unknown>) => {
      const rulesSnapshot = rules.map(cloneRule);
      const historyLength = history.length;

      try {
        return await callback(transactionClient);
      } catch (error) {
        rules = rulesSnapshot;
        history.splice(historyLength);
        throw error;
      }
    },
  );
  const prisma = {
    pricingRule: transactionClient.pricingRule,
    $transaction: runTransaction,
  } as unknown as PrismaService;

  return {
    service: new PricingService(prisma),
    findMany,
    update,
    createHistory,
    runTransaction,
    getRules: () => rules.map(cloneRule),
    history,
  };
}

describe('PricingService', () => {
  it('returns the 9 active unique PostgreSQL rules', async () => {
    const fixture = createFixture();

    const rules = await fixture.service.listActiveRules();
    const combinations = new Set(rules.map((rule) => `${rule.size}:${rule.detail}`));

    expect(rules).toHaveLength(9);
    expect(combinations.size).toBe(9);
    expect(fixture.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: [{ detail: 'asc' }, { size: 'asc' }],
    });
  });

  it.each([
    [TattooSize.SMALL, DetailLevel.LIGHT, '70', '80'],
    [TattooSize.MEDIUM, DetailLevel.DETAILED, '500', '700'],
    [TattooSize.LARGE, DetailLevel.DETAILED, '1500', '2000'],
  ])(
    'returns the current active %s/%s rule for a new quote',
    async (size, detail, expectedMinimum, expectedMaximum) => {
      const fixture = createFixture();

      const rule = await fixture.service.findActiveRule(size, detail);

      expect(rule?.minPrice.toString()).toBe(expectedMinimum);
      expect(rule?.maxPrice.toString()).toBe(expectedMaximum);
    },
  );

  it('updates prices, increments the version and records the complete history', async () => {
    const fixture = createFixture();
    const original = fixture.getRules()[0];

    const result = await fixture.service.updateActiveRules(
      [{ pricingRuleId: original.id, minPrice: 75, maxPrice: 85 }],
      USER_ID,
    );
    const updated = result.rules.find((rule) => rule.id === original.id)!;

    expect(result.updatedCount).toBe(1);
    expect(updated.minPrice.toString()).toBe('75');
    expect(updated.maxPrice.toString()).toBe('85');
    expect(updated.version).toBe(2);
    expect(fixture.history).toHaveLength(1);
    expect(fixture.history[0]).toMatchObject({
      pricingRuleId: original.id,
      changedByUserId: USER_ID,
    });
    expect(fixture.history[0]?.oldMinPrice.toString()).toBe(original.minPrice.toString());
    expect(fixture.history[0]?.oldMaxPrice.toString()).toBe(original.maxPrice.toString());
    expect(fixture.history[0]?.newMinPrice.toString()).toBe('75');
    expect(fixture.history[0]?.newMaxPrice.toString()).toBe('85');
    expect(fixture.runTransaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  });

  it('does not update, increment or create history for an unchanged rule', async () => {
    const fixture = createFixture();
    const original = fixture.getRules()[0];

    const result = await fixture.service.updateActiveRules(
      [
        {
          pricingRuleId: original.id,
          minPrice: original.minPrice.toNumber(),
          maxPrice: original.maxPrice.toNumber(),
        },
      ],
      USER_ID,
    );

    expect(result.updatedCount).toBe(0);
    expect(result.rules[0]?.version).toBe(1);
    expect(fixture.update).not.toHaveBeenCalled();
    expect(fixture.createHistory).not.toHaveBeenCalled();
  });

  it.each([
    [-1, 80, 'Los precios deben ser números válidos, positivos y con máximo dos decimales.'],
    [
      70,
      Number.NaN,
      'Los precios deben ser números válidos, positivos y con máximo dos decimales.',
    ],
    [70.123, 80, 'Los precios deben ser números válidos, positivos y con máximo dos decimales.'],
    [90, 80, 'El precio máximo debe ser igual o mayor al precio mínimo.'],
  ])(
    'rejects an invalid price pair before opening a transaction',
    async (minPrice, maxPrice, message) => {
      const fixture = createFixture();
      const rule = fixture.getRules()[0];

      await expect(
        fixture.service.updateActiveRules(
          [{ pricingRuleId: rule.id, minPrice, maxPrice }],
          USER_ID,
        ),
      ).rejects.toEqual(new BadRequestException(message));
      expect(fixture.runTransaction).not.toHaveBeenCalled();
    },
  );

  it('rejects duplicate rule identifiers', async () => {
    const fixture = createFixture();
    const rule = fixture.getRules()[0];

    await expect(
      fixture.service.updateActiveRules(
        [
          { pricingRuleId: rule.id, minPrice: 75, maxPrice: 85 },
          { pricingRuleId: rule.id, minPrice: 76, maxPrice: 86 },
        ],
        USER_ID,
      ),
    ).rejects.toEqual(
      new BadRequestException('No puedes modificar la misma regla más de una vez.'),
    );
  });

  it('rolls back every price and history entry when one update fails', async () => {
    const initialFixture = createFixture();
    const originals = initialFixture.getRules();
    const first = originals[0];
    const second = originals[1];
    const fixture = createFixture(second.id);

    await expect(
      fixture.service.updateActiveRules(
        [
          { pricingRuleId: first.id, minPrice: 75, maxPrice: 85 },
          { pricingRuleId: second.id, minPrice: 275, maxPrice: 375 },
        ],
        USER_ID,
      ),
    ).rejects.toThrow('simulated update failure');

    expect(
      fixture.getRules().map((rule) => [rule.minPrice.toString(), rule.maxPrice.toString()]),
    ).toEqual(originals.map((rule) => [rule.minPrice.toString(), rule.maxPrice.toString()]));
    expect(fixture.history).toHaveLength(0);
  });

  it('keeps a historical lead price while new quotes use the updated active rule', async () => {
    const fixture = createFixture();
    const rule = fixture
      .getRules()
      .find(
        (candidate) =>
          candidate.size === TattooSize.MEDIUM && candidate.detail === DetailLevel.DETAILED,
      )!;
    const historicalLead = {
      calculatedMinPrice: new Prisma.Decimal(rule.minPrice),
      calculatedMaxPrice: new Prisma.Decimal(rule.maxPrice),
      pricingRuleVersion: rule.version,
    };

    await fixture.service.updateActiveRules(
      [{ pricingRuleId: rule.id, minPrice: 550, maxPrice: 750 }],
      USER_ID,
    );
    const currentRule = await fixture.service.findActiveRule(
      TattooSize.MEDIUM,
      DetailLevel.DETAILED,
    );

    expect(historicalLead).toMatchObject({ pricingRuleVersion: 1 });
    expect(historicalLead.calculatedMinPrice.toString()).toBe('500');
    expect(historicalLead.calculatedMaxPrice.toString()).toBe('700');
    expect(currentRule?.minPrice.toString()).toBe('550');
    expect(currentRule?.maxPrice.toString()).toBe('750');
    expect(currentRule?.version).toBe(2);
  });
});

import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { initialPricingRules } from './pricing-rules.seed-data.js';

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DIRECT_URL or DATABASE_URL is required to seed the database.');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function seed() {
  await prisma.$transaction(
    initialPricingRules.map((pricingRule) =>
      prisma.pricingRule.upsert({
        where: {
          size_detail: {
            size: pricingRule.size,
            detail: pricingRule.detail,
          },
        },
        update: {},
        create: pricingRule,
      }),
    ),
  );
}

async function main(): Promise<void> {
  try {
    await seed();
    console.info('Pricing rules seeded successfully.');
  } finally {
    await prisma.$disconnect();
  }
}

void main();

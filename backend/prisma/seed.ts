import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { INITIAL_TATTOO_STYLES } from './tattoo-styles.seed-data.js';

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DIRECT_URL or DATABASE_URL is required to seed the database.');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function seed() {
  await prisma.$transaction(
    INITIAL_TATTOO_STYLES.map((style) =>
      prisma.tattooStyle.upsert({
        where: { code: style.code },
        update: {},
        create: style,
      }),
    ),
  );
}

async function main(): Promise<void> {
  try {
    await seed();
    console.info('Tattoo styles seeded successfully.');
  } finally {
    await prisma.$disconnect();
  }
}

void main();

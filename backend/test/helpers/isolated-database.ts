import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { parse } from 'dotenv';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';

/** Runs the real migrations in a disposable schema; never migrates the application schema. */
export async function isolatedDatabase(
  beforeMigration?: (name: string, client: pg.Client) => Promise<void>,
  options: { maxConnections?: number } = {},
) {
  const local = parse(readFileSync('.env', 'utf8'));
  const configuredUrl = local.DIRECT_URL ?? local.DATABASE_URL;
  if (!configuredUrl) throw new Error('DATABASE_URL is required for database E2E tests.');
  // Transaction pooling does not preserve search_path between statements.
  // Tests use the corresponding session pooler without changing application configuration.
  const url = new URL(configuredUrl);
  if (url.hostname.endsWith('.pooler.supabase.com') && url.port === '6543') url.port = '5432';
  const connectionString = url.toString();
  const schema = `nita_cleanup_${randomUUID().replaceAll('-', '')}`;
  if (!/^nita_cleanup_[a-f0-9]{32}$/.test(schema)) throw new Error('Invalid test schema.');
  const identifier = `"${schema}"`;
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10_000 });
  await client.connect();
  let created = false;
  let prisma: PrismaClient | undefined;
  const close = async () => {
    try {
      await prisma?.$disconnect();
      if (created) {
        await client.query('ROLLBACK');
        await client.query(`DROP SCHEMA ${identifier} CASCADE`);
        created = false;
      }
    } finally {
      await client.end();
    }
  };
  try {
    await client.query(`CREATE SCHEMA ${identifier}`);
    created = true;
    await client.query(`SET search_path TO ${identifier}`);
    const migrations = readdirSync('prisma/migrations', { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const name of migrations) {
      await beforeMigration?.(name, client);
      await client.query(readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8'));
    }
    prisma = new PrismaClient({
      adapter: new PrismaPg(
        { connectionString, max: options.maxConnections ?? 1, options: `-c search_path=${schema}` },
        { schema },
      ),
    });
    return { prisma, client, schema, close };
  } catch (error) {
    await close();
    throw error;
  }
}

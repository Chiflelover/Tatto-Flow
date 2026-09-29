import { readFileSync } from 'node:fs';

describe('V1 migration compatibility', () => {
  it('backfills existing conversations as V1 and defaults new conversations to V1', () => {
    const migration = readFileSync(
      'prisma/migrations/20260929190000_add_artist_accounts_and_roles/migration.sql',
      'utf8',
    );
    const schema = readFileSync('prisma/schema.prisma', 'utf8');

    expect(migration).toContain('ADD COLUMN "flow_version" "flow_version" NOT NULL DEFAULT \'V1\'');
    expect(schema).toMatch(/flowVersion\s+FlowVersion\s+@default\(V1\)/);
  });
});

import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('./migrations/20260926210000_add_manual_final_price/migration.sql', import.meta.url),
  'utf8',
);

describe('manual final price migration', () => {
  it('only adds a nullable decimal column and remains compatible with existing leads', () => {
    expect(migration.replaceAll('\r\n', '\n').trim()).toBe(
      'ALTER TABLE "leads"\nADD COLUMN "manual_final_price" DECIMAL(10, 2);',
    );
    expect(migration).not.toMatch(/NOT NULL|DEFAULT|DROP|DELETE|UPDATE/i);
  });
});

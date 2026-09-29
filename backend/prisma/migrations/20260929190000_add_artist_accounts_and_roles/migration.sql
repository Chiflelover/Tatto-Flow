CREATE TYPE "user_role" AS ENUM ('ADMIN', 'TATTOO_ARTIST');
CREATE TYPE "flow_version" AS ENUM ('V1', 'V2');

CREATE TABLE "tattoo_artist_accounts" (
  "id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tattoo_artist_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "whatsapp_channels" (
  "id" UUID NOT NULL,
  "account_id" UUID NOT NULL,
  "phone_number" VARCHAR(20) NOT NULL,
  "phone_number_id" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "whatsapp_channels_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "whatsapp_channels_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "tattoo_artist_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "whatsapp_channels_phone_number_format" CHECK ("phone_number" ~ '^[1-9][0-9]{7,14}$'),
  CONSTRAINT "whatsapp_channels_phone_number_id_format" CHECK ("phone_number_id" ~ '^[0-9]+$')
);
CREATE UNIQUE INDEX "whatsapp_channels_account_id_key" ON "whatsapp_channels"("account_id");
CREATE UNIQUE INDEX "whatsapp_channels_phone_number_key" ON "whatsapp_channels"("phone_number");
CREATE UNIQUE INDEX "whatsapp_channels_phone_number_id_key" ON "whatsapp_channels"("phone_number_id");

ALTER TABLE "users" ADD COLUMN "role" "user_role" NOT NULL DEFAULT 'TATTOO_ARTIST', ADD COLUMN "account_id" UUID;
ALTER TABLE "customers" ADD COLUMN "account_id" UUID;
ALTER TABLE "conversations" ADD COLUMN "account_id" UUID, ADD COLUMN "flow_version" "flow_version" NOT NULL DEFAULT 'V1';
ALTER TABLE "leads" ADD COLUMN "account_id" UUID;
ALTER TABLE "pricing_rules" ADD COLUMN "account_id" UUID;

-- All v0.1 business data belongs to the original tattoo artist. The first
-- existing user owns that account; any additional users retain separate access.
INSERT INTO "tattoo_artist_accounts" ("id", "name")
VALUES ('00000000-0000-4000-8000-000000000001', 'Cuenta heredada');

DO $$
DECLARE
  first_user UUID;
  extra_user RECORD;
  new_account UUID;
BEGIN
  SELECT "id" INTO first_user FROM "users" ORDER BY "created_at", "id" LIMIT 1;
  IF first_user IS NOT NULL THEN
    UPDATE "users" SET "account_id" = '00000000-0000-4000-8000-000000000001' WHERE "id" = first_user;
  END IF;
  FOR extra_user IN SELECT "id", "email" FROM "users" WHERE "id" IS DISTINCT FROM first_user LOOP
    new_account := gen_random_uuid();
    INSERT INTO "tattoo_artist_accounts" ("id", "name") VALUES (new_account, extra_user."email");
    UPDATE "users" SET "account_id" = new_account WHERE "id" = extra_user."id";
  END LOOP;
END $$;

UPDATE "customers" SET "account_id" = '00000000-0000-4000-8000-000000000001';
UPDATE "conversations" SET "account_id" = '00000000-0000-4000-8000-000000000001';
UPDATE "leads" SET "account_id" = '00000000-0000-4000-8000-000000000001';
UPDATE "pricing_rules" SET "account_id" = '00000000-0000-4000-8000-000000000001';

ALTER TABLE "customers" ALTER COLUMN "account_id" SET NOT NULL;
ALTER TABLE "conversations" ALTER COLUMN "account_id" SET NOT NULL;
ALTER TABLE "leads" ALTER COLUMN "account_id" SET NOT NULL;
ALTER TABLE "pricing_rules" ALTER COLUMN "account_id" SET NOT NULL;

DROP INDEX "customers_phone_number_key";
CREATE UNIQUE INDEX "customers_account_id_phone_number_key" ON "customers"("account_id", "phone_number");
DROP INDEX "pricing_rules_size_detail_key";
CREATE UNIQUE INDEX "pricing_rules_account_id_size_detail_key" ON "pricing_rules"("account_id", "size", "detail");
CREATE UNIQUE INDEX "users_account_id_key" ON "users"("account_id");
CREATE INDEX "conversations_account_id_status_last_activity_at_idx" ON "conversations"("account_id", "status", "last_activity_at");
CREATE INDEX "leads_account_id_status_created_at_idx" ON "leads"("account_id", "status", "created_at");

ALTER TABLE "users" ADD CONSTRAINT "users_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "tattoo_artist_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customers" ADD CONSTRAINT "customers_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "tattoo_artist_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "tattoo_artist_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leads" ADD CONSTRAINT "leads_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "tattoo_artist_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "tattoo_artist_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_role_account_check" CHECK (("role" = 'ADMIN' AND "account_id" IS NULL) OR ("role" = 'TATTOO_ARTIST' AND "account_id" IS NOT NULL));

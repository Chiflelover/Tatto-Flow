-- CreateEnum
CREATE TYPE "booking_intent" AS ENUM ('DIRECT_BOOKING', 'ARTIST_CONTACT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "conversation_state" ADD VALUE 'PRICE_READY';
ALTER TYPE "conversation_state" ADD VALUE 'ASK_ADVANCE_INTENT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "lead_status" ADD VALUE 'AUTO_QUOTED';
ALTER TYPE "lead_status" ADD VALUE 'SPECIAL_REVIEW';
ALTER TYPE "lead_status" ADD VALUE 'READY_TO_COORDINATE';

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "booking_intent" "booking_intent";

-- CreateTable
CREATE TABLE "quotes" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "pricing_model_version_id" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'PEN',
    "target_area_cm2" DECIMAL(65,30) NOT NULL,
    "target_color_coverage" DECIMAL(24,20) NOT NULL,
    "detected_style" VARCHAR(64) NOT NULL,
    "general_adjustment_percent" DECIMAL(7,2) NOT NULL,
    "algorithm_version" VARCHAR(64) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_deliveries" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "payload" JSONB NOT NULL,
    "claim_id" UUID,
    "lease_until" TIMESTAMPTZ(3),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMPTZ(3),
    "last_error_code" VARCHAR(64),
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quotes_lead_id_key" ON "quotes"("lead_id");

-- CreateIndex
CREATE INDEX "quotes_account_id_created_at_idx" ON "quotes"("account_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "quotes_lead_id_account_id_key" ON "quotes"("lead_id", "account_id");

-- CreateIndex
CREATE INDEX "whatsapp_deliveries_account_id_sent_at_idx" ON "whatsapp_deliveries"("account_id", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_deliveries_lead_id_kind_key" ON "whatsapp_deliveries"("lead_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_model_versions_id_account_id_key" ON "pricing_model_versions"("id", "account_id");

-- CreateIndex
CREATE UNIQUE INDEX "leads_id_account_id_key" ON "leads"("id", "account_id");

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_lead_id_account_id_fkey" FOREIGN KEY ("lead_id", "account_id") REFERENCES "leads"("id", "account_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "tattoo_artist_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_pricing_model_version_id_account_id_fkey" FOREIGN KEY ("pricing_model_version_id", "account_id") REFERENCES "pricing_model_versions"("id", "account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_deliveries" ADD CONSTRAINT "whatsapp_deliveries_lead_id_account_id_fkey" FOREIGN KEY ("lead_id", "account_id") REFERENCES "leads"("id", "account_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quotes"
  ADD CONSTRAINT "quotes_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "quotes_currency_pen" CHECK ("currency" = 'PEN'),
  ADD CONSTRAINT "quotes_area_positive" CHECK ("target_area_cm2" > 0),
  ADD CONSTRAINT "quotes_color_range" CHECK ("target_color_coverage" BETWEEN 0 AND 1);

ALTER TABLE "whatsapp_deliveries"
  ADD CONSTRAINT "whatsapp_deliveries_kind" CHECK ("kind" IN ('RESULT', 'ADVANCE_INTENT', 'HANDOFF')),
  ADD CONSTRAINT "whatsapp_deliveries_attempt_count" CHECK ("attempt_count" >= 0),
  ADD CONSTRAINT "whatsapp_deliveries_claim_pair" CHECK (("claim_id" IS NULL) = ("lease_until" IS NULL));

CREATE FUNCTION reject_quote_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Quote snapshots are immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER quotes_immutable BEFORE UPDATE ON "quotes"
FOR EACH ROW EXECUTE FUNCTION reject_quote_update();


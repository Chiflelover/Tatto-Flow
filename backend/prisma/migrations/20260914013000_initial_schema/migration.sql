-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "tattoo_size" AS ENUM ('SMALL', 'MEDIUM', 'LARGE');

-- CreateEnum
CREATE TYPE "detail_level" AS ENUM ('LIGHT', 'MEDIUM', 'DETAILED');

-- CreateEnum
CREATE TYPE "conversation_status" AS ENUM ('ACTIVE', 'ABANDONED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "conversation_state" AS ENUM ('START', 'ASK_SIZE', 'ASK_DETAIL', 'ASK_BODY_PART', 'WAITING_IMAGE', 'ANALYZING', 'VALIDATING', 'HANDOFF_TO_TATTOO_ARTIST');

-- CreateEnum
CREATE TYPE "lead_status" AS ENUM ('ANALYZING', 'VERIFIED', 'REQUIRES_REVIEW', 'HANDOFF_TO_TATTOO_ARTIST', 'COMPLETED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "phone_number" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "current_state" "conversation_state" NOT NULL DEFAULT 'START',
    "status" "conversation_status" NOT NULL DEFAULT 'ACTIVE',
    "last_activity_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "conversation_id" UUID,
    "selected_size" "tattoo_size" NOT NULL,
    "selected_detail" "detail_level" NOT NULL,
    "body_part" VARCHAR(10) NOT NULL,
    "status" "lead_status" NOT NULL DEFAULT 'ANALYZING',
    "calculated_min_price" DECIMAL(10,2),
    "calculated_max_price" DECIMAL(10,2),
    "pricing_rule_id" UUID,
    "pricing_rule_version" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_images" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "storage_path" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "lead_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_analyses" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "detected_size" "tattoo_size" NOT NULL,
    "size_confidence" DECIMAL(4,3) NOT NULL,
    "detected_detail" "detail_level" NOT NULL,
    "detail_confidence" DECIMAL(4,3) NOT NULL,
    "raw_response" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_rules" (
    "id" UUID NOT NULL,
    "size" "tattoo_size" NOT NULL,
    "detail" "detail_level" NOT NULL,
    "min_price" DECIMAL(10,2) NOT NULL,
    "max_price" DECIMAL(10,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pricing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_rule_history" (
    "id" UUID NOT NULL,
    "pricing_rule_id" UUID NOT NULL,
    "old_min_price" DECIMAL(10,2) NOT NULL,
    "old_max_price" DECIMAL(10,2) NOT NULL,
    "new_min_price" DECIMAL(10,2) NOT NULL,
    "new_max_price" DECIMAL(10,2) NOT NULL,
    "changed_by_user_id" UUID NOT NULL,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_rule_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "customers_phone_number_key" ON "customers"("phone_number");

-- CreateIndex
CREATE INDEX "conversations_customer_id_idx" ON "conversations"("customer_id");

-- CreateIndex
CREATE INDEX "conversations_status_last_activity_at_idx" ON "conversations"("status", "last_activity_at");

-- A customer can only have one active quotation conversation at a time.
CREATE UNIQUE INDEX "conversations_one_active_per_customer_idx"
ON "conversations"("customer_id")
WHERE "status" = 'ACTIVE';

-- CreateIndex
CREATE UNIQUE INDEX "leads_conversation_id_key" ON "leads"("conversation_id");

-- CreateIndex
CREATE INDEX "leads_customer_id_idx" ON "leads"("customer_id");

-- CreateIndex
CREATE INDEX "leads_status_created_at_idx" ON "leads"("status", "created_at");

-- CreateIndex
CREATE INDEX "leads_pricing_rule_id_idx" ON "leads"("pricing_rule_id");

-- CreateIndex
CREATE INDEX "lead_images_lead_id_idx" ON "lead_images"("lead_id");

-- CreateIndex
CREATE INDEX "lead_images_expires_at_deleted_at_idx" ON "lead_images"("expires_at", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "ai_analyses_lead_id_key" ON "ai_analyses"("lead_id");

-- CreateIndex
CREATE INDEX "pricing_rules_is_active_idx" ON "pricing_rules"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_rules_size_detail_key" ON "pricing_rules"("size", "detail");

-- CreateIndex
CREATE INDEX "pricing_rule_history_pricing_rule_id_changed_at_idx" ON "pricing_rule_history"("pricing_rule_id", "changed_at");

-- CreateIndex
CREATE INDEX "pricing_rule_history_changed_by_user_id_idx" ON "pricing_rule_history"("changed_by_user_id");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_pricing_rule_id_fkey" FOREIGN KEY ("pricing_rule_id") REFERENCES "pricing_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_images" ADD CONSTRAINT "lead_images_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_rule_history" ADD CONSTRAINT "pricing_rule_history_pricing_rule_id_fkey" FOREIGN KEY ("pricing_rule_id") REFERENCES "pricing_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_rule_history" ADD CONSTRAINT "pricing_rule_history_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain checks not represented by the Prisma schema language
ALTER TABLE "users"
ADD CONSTRAINT "users_email_not_blank" CHECK (btrim("email") <> ''),
ADD CONSTRAINT "users_password_hash_not_blank" CHECK (btrim("password_hash") <> '');

ALTER TABLE "customers"
ADD CONSTRAINT "customers_phone_number_not_blank" CHECK (btrim("phone_number") <> '');

ALTER TABLE "leads"
ADD CONSTRAINT "leads_body_part_length" CHECK (char_length(btrim("body_part")) BETWEEN 1 AND 10),
ADD CONSTRAINT "leads_price_pair" CHECK (("calculated_min_price" IS NULL) = ("calculated_max_price" IS NULL)),
ADD CONSTRAINT "leads_price_range" CHECK (
    "calculated_min_price" IS NULL
    OR ("calculated_min_price" >= 0 AND "calculated_max_price" >= "calculated_min_price")
),
ADD CONSTRAINT "leads_pricing_snapshot_pair" CHECK (("pricing_rule_id" IS NULL) = ("pricing_rule_version" IS NULL)),
ADD CONSTRAINT "leads_pricing_rule_version_positive" CHECK ("pricing_rule_version" IS NULL OR "pricing_rule_version" >= 1);

ALTER TABLE "lead_images"
ADD CONSTRAINT "lead_images_storage_path_not_blank" CHECK (btrim("storage_path") <> ''),
ADD CONSTRAINT "lead_images_expiration_window" CHECK (
    "expires_at" > "created_at"
    AND "expires_at" <= "created_at" + INTERVAL '15 days'
),
ADD CONSTRAINT "lead_images_deletion_after_creation" CHECK ("deleted_at" IS NULL OR "deleted_at" >= "created_at");

ALTER TABLE "ai_analyses"
ADD CONSTRAINT "ai_analyses_size_confidence_range" CHECK ("size_confidence" BETWEEN 0 AND 1),
ADD CONSTRAINT "ai_analyses_detail_confidence_range" CHECK ("detail_confidence" BETWEEN 0 AND 1);

ALTER TABLE "pricing_rules"
ADD CONSTRAINT "pricing_rules_price_range" CHECK ("min_price" >= 0 AND "max_price" >= "min_price"),
ADD CONSTRAINT "pricing_rules_version_positive" CHECK ("version" >= 1);

ALTER TABLE "pricing_rule_history"
ADD CONSTRAINT "pricing_rule_history_old_price_range" CHECK ("old_min_price" >= 0 AND "old_max_price" >= "old_min_price"),
ADD CONSTRAINT "pricing_rule_history_new_price_range" CHECK ("new_min_price" >= 0 AND "new_max_price" >= "new_min_price");

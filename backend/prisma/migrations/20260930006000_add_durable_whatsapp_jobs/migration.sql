-- CreateEnum
CREATE TYPE "whatsapp_job_status" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'RETRYABLE', 'UNKNOWN');

-- AlterTable
ALTER TABLE "whatsapp_deliveries" ADD COLUMN     "job_id" UUID,
ADD COLUMN     "sequence" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "lead_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "whatsapp_jobs" (
    "id" UUID NOT NULL,
    "inbound_message_id" VARCHAR(255) NOT NULL,
    "account_id" UUID NOT NULL,
    "channel_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "phone_number_id" VARCHAR(64) NOT NULL,
    "flow_version" "flow_version" NOT NULL DEFAULT 'V2',
    "conversation_id" UUID,
    "lead_id" UUID,
    "image_id" UUID,
    "input" JSONB,
    "response" JSONB,
    "input_processed_at" TIMESTAMPTZ(3),
    "status" "whatsapp_job_status" NOT NULL DEFAULT 'PENDING',
    "claim_id" UUID,
    "lease_until" TIMESTAMPTZ(3),
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "last_error_code" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "whatsapp_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_jobs_inbound_message_id_key" ON "whatsapp_jobs"("inbound_message_id");

-- CreateIndex
CREATE INDEX "whatsapp_jobs_status_available_at_idx" ON "whatsapp_jobs"("status", "available_at");

-- CreateIndex
CREATE INDEX "whatsapp_jobs_account_id_customer_id_created_at_idx" ON "whatsapp_jobs"("account_id", "customer_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_jobs_id_account_id_key" ON "whatsapp_jobs"("id", "account_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_channels_id_account_id_key" ON "whatsapp_channels"("id", "account_id");

-- CreateIndex
CREATE UNIQUE INDEX "customers_id_account_id_key" ON "customers"("id", "account_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_deliveries_job_id_sequence_key" ON "whatsapp_deliveries"("job_id", "sequence");

-- AddForeignKey
ALTER TABLE "whatsapp_deliveries" ADD CONSTRAINT "whatsapp_deliveries_job_id_account_id_fkey" FOREIGN KEY ("job_id", "account_id") REFERENCES "whatsapp_jobs"("id", "account_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_jobs" ADD CONSTRAINT "whatsapp_jobs_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "tattoo_artist_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_jobs" ADD CONSTRAINT "whatsapp_jobs_channel_id_account_id_fkey" FOREIGN KEY ("channel_id", "account_id") REFERENCES "whatsapp_channels"("id", "account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_jobs" ADD CONSTRAINT "whatsapp_jobs_customer_id_account_id_fkey" FOREIGN KEY ("customer_id", "account_id") REFERENCES "customers"("id", "account_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_jobs" ADD CONSTRAINT "whatsapp_jobs_inbound_message_id_fkey" FOREIGN KEY ("inbound_message_id") REFERENCES "whatsapp_inbound_messages"("message_id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE whatsapp_deliveries DROP CONSTRAINT whatsapp_deliveries_kind;
ALTER TABLE whatsapp_deliveries ADD CONSTRAINT whatsapp_deliveries_kind CHECK (
  (kind = 'INTAKE' AND job_id IS NOT NULL AND lead_id IS NULL)
  OR (kind IN ('RESULT', 'ADVANCE_INTENT', 'HANDOFF') AND lead_id IS NOT NULL)
), ADD CONSTRAINT whatsapp_deliveries_sequence CHECK (sequence >= 0);
ALTER TABLE whatsapp_jobs
  ADD CONSTRAINT whatsapp_jobs_v2 CHECK (flow_version = 'V2'),
  ADD CONSTRAINT whatsapp_jobs_attempts CHECK (attempt_count >= 0),
  ADD CONSTRAINT whatsapp_jobs_claim CHECK ((status = 'PROCESSING' AND claim_id IS NOT NULL AND lease_until IS NOT NULL) OR (status <> 'PROCESSING' AND claim_id IS NULL AND lease_until IS NULL)),
  ADD CONSTRAINT whatsapp_jobs_receipt CHECK ((input_processed_at IS NULL AND input IS NOT NULL AND response IS NULL) OR (input_processed_at IS NOT NULL AND input IS NULL AND response IS NOT NULL));

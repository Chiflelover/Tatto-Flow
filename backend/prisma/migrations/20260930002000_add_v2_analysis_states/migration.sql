ALTER TYPE "conversation_state" ADD VALUE 'READY_FOR_PRICING';
ALTER TYPE "conversation_state" ADD VALUE 'HUMAN_REVIEW';
ALTER TYPE "conversation_state" ADD VALUE 'SPECIAL_REVIEW';

ALTER TABLE "conversations"
  ADD COLUMN "v2_analysis_claim_id" UUID,
  ADD COLUMN "v2_analysis_lease_until" TIMESTAMPTZ(3);

ALTER TABLE "leads" ADD COLUMN "v2_preparation" JSONB;

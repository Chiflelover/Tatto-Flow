ALTER TYPE "conversation_state" ADD VALUE 'ASK_TARGET_SIZE_AFTER_ANALYSIS';
ALTER TYPE "conversation_state" ADD VALUE 'INVALID_REFERENCE';

-- SAME_SIZE may now collect a client dimension after analysis; finite positive size checks remain.
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_same_size_without_target";
ALTER TABLE "leads" DROP CONSTRAINT "leads_same_size_without_target";

ALTER TABLE "ai_analyses"
  ADD COLUMN "composition_aspect_ratio" DOUBLE PRECISION,
  ADD COLUMN "composition_fill_ratio" DOUBLE PRECISION,
  ADD COLUMN "valid_tattoo_reference" BOOLEAN,
  ADD COLUMN "reference_validation_confidence" DOUBLE PRECISION;

ALTER TABLE "ai_analyses"
  ADD CONSTRAINT "ai_analyses_composition_aspect_ratio_range"
    CHECK ("composition_aspect_ratio" > 0 AND "composition_aspect_ratio" <= 1),
  ADD CONSTRAINT "ai_analyses_composition_fill_ratio_range"
    CHECK ("composition_fill_ratio" > 0 AND "composition_fill_ratio" <= 1),
  ADD CONSTRAINT "ai_analyses_reference_validation_confidence_range"
    CHECK ("reference_validation_confidence" >= 0 AND "reference_validation_confidence" <= 1);

ALTER TABLE "whatsapp_deliveries"
  DROP CONSTRAINT "whatsapp_deliveries_kind",
  ADD CONSTRAINT "whatsapp_deliveries_kind" CHECK (
    (kind = 'INTAKE' AND job_id IS NOT NULL AND lead_id IS NULL)
    OR (kind IN ('TARGET_SIZE', 'INVALID_REFERENCE', 'RESULT', 'ADVANCE_INTENT', 'HANDOFF') AND lead_id IS NOT NULL)
  );

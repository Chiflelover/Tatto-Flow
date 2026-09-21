-- Add a readiness classification independent from the operational lead status.
CREATE TYPE "readiness_status" AS ENUM ('LISTO', 'REVISAR', 'INCOMPLETO');

-- Preserve the operational reason when a reference is not a tattoo on skin.
ALTER TYPE "review_reason" ADD VALUE 'NOT_ON_SKIN';

CREATE TABLE "lead_evaluations" (
    "id" UUID NOT NULL,
    "lead_id" UUID NOT NULL,
    "raw_score" INTEGER NOT NULL,
    "max_positive_score" INTEGER NOT NULL,
    "readiness_score" DECIMAL(5,2) NOT NULL,
    "readiness_status" "readiness_status" NOT NULL,
    "rules_version" INTEGER NOT NULL,
    "contributions" JSONB NOT NULL,
    "blockers" JSONB NOT NULL,
    "evaluated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lead_evaluations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lead_evaluations_lead_id_key" ON "lead_evaluations"("lead_id");

ALTER TABLE "lead_evaluations"
ADD CONSTRAINT "lead_evaluations_lead_id_fkey"
FOREIGN KEY ("lead_id") REFERENCES "leads"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

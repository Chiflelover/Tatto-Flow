-- Additive only: historical analyses retain NULL density and their original contract.
ALTER TABLE "ai_analyses"
  ADD COLUMN "estimated_density" DOUBLE PRECISION;

ALTER TABLE "ai_analyses"
  ADD CONSTRAINT "ai_analyses_estimated_density_range"
    CHECK ("estimated_density" IS NULL OR "estimated_density" BETWEEN 0 AND 100);

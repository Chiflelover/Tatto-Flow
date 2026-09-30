CREATE TYPE "scale_reference_type" AS ENUM ('EXPLICIT_REFERENCE', 'BODY_CONTEXT', 'NONE');

-- Preserve V1 and earlier V2 observations without fabricating their source of scale.
ALTER TABLE "ai_analyses"
  ADD COLUMN "scale_reference_type" "scale_reference_type",
  ADD COLUMN "scale_confidence" DOUBLE PRECISION,
  ADD CONSTRAINT "ai_analyses_scale_confidence_range" CHECK ("scale_confidence" BETWEEN 0 AND 1),
  ADD CONSTRAINT "ai_analyses_scale_contract" CHECK (
    (
      "analysis_version" = 'V1'
      AND "scale_reference_type" IS NULL AND "scale_confidence" IS NULL
    ) OR (
      "analysis_version" = 'V2'
      AND (
        (
          "schema_version" = 'VISION_V2_1'
          AND "scale_reference_type" IS NULL AND "scale_confidence" IS NULL
        ) OR (
          "scale_reference_type" IS NOT NULL AND "scale_confidence" IS NOT NULL
          AND (
            "scale_reference_type" <> 'NONE'
            OR ("reference_main_dimension_cm" IS NULL AND "reference_area_cm2" IS NULL)
          )
        )
      )
    )
  );

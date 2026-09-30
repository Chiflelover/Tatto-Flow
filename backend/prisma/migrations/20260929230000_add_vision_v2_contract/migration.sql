CREATE TYPE "analysis_version" AS ENUM ('V1', 'V2');

-- Existing observations remain V1 and retain their original values and raw response.
ALTER TABLE "ai_analyses"
  ADD COLUMN "analysis_version" "analysis_version" NOT NULL DEFAULT 'V1',
  ALTER COLUMN "detected_size" DROP NOT NULL,
  ALTER COLUMN "size_confidence" DROP NOT NULL,
  ALTER COLUMN "detected_detail" DROP NOT NULL,
  ALTER COLUMN "detail_confidence" DROP NOT NULL,
  ADD COLUMN "style" VARCHAR(64),
  ADD COLUMN "style_confidence" DOUBLE PRECISION,
  ADD COLUMN "reference_main_dimension_cm" DOUBLE PRECISION,
  ADD COLUMN "reference_area_cm2" DOUBLE PRECISION,
  ADD COLUMN "area_confidence" DOUBLE PRECISION,
  ADD COLUMN "color_coverage" DOUBLE PRECISION,
  ADD COLUMN "color_confidence" DOUBLE PRECISION,
  ADD COLUMN "overall_confidence" DOUBLE PRECISION,
  ADD COLUMN "reference_essentially_black" BOOLEAN,
  ADD COLUMN "extensive_body_coverage" BOOLEAN,
  ADD COLUMN "prompt_version" INTEGER,
  ADD COLUMN "schema_version" VARCHAR(64),
  ADD COLUMN "provider" VARCHAR(64),
  ADD COLUMN "model" VARCHAR(128);

ALTER TABLE "ai_analyses"
  ADD CONSTRAINT "ai_analyses_v2_style_confidence_range" CHECK ("style_confidence" BETWEEN 0 AND 1),
  ADD CONSTRAINT "ai_analyses_v2_area_confidence_range" CHECK ("area_confidence" BETWEEN 0 AND 1),
  ADD CONSTRAINT "ai_analyses_v2_color_confidence_range" CHECK ("color_confidence" BETWEEN 0 AND 1),
  ADD CONSTRAINT "ai_analyses_v2_overall_confidence_range" CHECK ("overall_confidence" BETWEEN 0 AND 1),
  ADD CONSTRAINT "ai_analyses_v2_color_coverage_range" CHECK ("color_coverage" BETWEEN 0 AND 1),
  ADD CONSTRAINT "ai_analyses_v2_dimension_positive" CHECK (
    "reference_main_dimension_cm" > 0 AND "reference_main_dimension_cm" < 'Infinity'::double precision
  ),
  ADD CONSTRAINT "ai_analyses_v2_area_positive" CHECK (
    "reference_area_cm2" > 0 AND "reference_area_cm2" < 'Infinity'::double precision
  ),
  ADD CONSTRAINT "ai_analyses_contract_shape" CHECK (
    (
      "analysis_version" = 'V1'
      AND "detected_size" IS NOT NULL AND "size_confidence" IS NOT NULL
      AND "detected_detail" IS NOT NULL AND "detail_confidence" IS NOT NULL
      AND "style" IS NULL AND "style_confidence" IS NULL
      AND "reference_main_dimension_cm" IS NULL AND "reference_area_cm2" IS NULL
      AND "area_confidence" IS NULL AND "color_coverage" IS NULL
      AND "color_confidence" IS NULL AND "overall_confidence" IS NULL
      AND "reference_essentially_black" IS NULL AND "extensive_body_coverage" IS NULL
    ) OR (
      "analysis_version" = 'V2'
      AND "detected_size" IS NULL AND "size_confidence" IS NULL
      AND "detected_detail" IS NULL AND "detail_confidence" IS NULL
      AND "style_confidence" IS NOT NULL AND "area_confidence" IS NOT NULL
      AND "color_confidence" IS NOT NULL AND "overall_confidence" IS NOT NULL
      AND "reference_essentially_black" IS NOT NULL AND "extensive_body_coverage" IS NOT NULL
      AND "prompt_version" IS NOT NULL AND "schema_version" IS NOT NULL
      AND "provider" IS NOT NULL AND "model" IS NOT NULL AND "raw_response" IS NOT NULL
    )
  );

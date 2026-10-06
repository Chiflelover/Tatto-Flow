BEGIN;

CREATE TYPE "calibration_phase" AS ENUM ('A', 'B');

ALTER TABLE "calibration_cases"
  ALTER COLUMN "type" DROP NOT NULL,
  ALTER COLUMN "area_cm2" DROP NOT NULL,
  ADD COLUMN "case_key" VARCHAR(64),
  ADD COLUMN "phase" "calibration_phase",
  ADD COLUMN "image_key" TEXT,
  ADD COLUMN "size_cm" DOUBLE PRECISION,
  ADD COLUMN "density" DOUBLE PRECISION,
  ADD COLUMN "color_metadata" JSONB,
  ADD COLUMN "density_metadata" JSONB,
  ADD COLUMN "catalog_version" VARCHAR(64),
  ADD COLUMN "base_case_key" VARCHAR(64);

CREATE UNIQUE INDEX "calibration_cases_case_key_key" ON "calibration_cases"("case_key");
CREATE UNIQUE INDEX "calibration_cases_image_key_key" ON "calibration_cases"("image_key");
CREATE UNIQUE INDEX "calibration_cases_image_key_case_insensitive" ON "calibration_cases"(lower("image_key"));

ALTER TABLE "calibration_cases"
  ADD CONSTRAINT "calibration_cases_base_case_key_fkey" FOREIGN KEY ("base_case_key")
    REFERENCES "calibration_cases"("case_key") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "calibration_cases_size_cm_check"
    CHECK ("size_cm" IS NULL OR ("size_cm" > 0 AND "size_cm" < 'Infinity'::double precision)),
  ADD CONSTRAINT "calibration_cases_density_check"
    CHECK ("density" IS NULL OR "density" BETWEEN 0 AND 100),
  ADD CONSTRAINT "calibration_cases_catalog_shape" CHECK (
    ("phase" IS NULL AND "type" IS NOT NULL AND "area_cm2" IS NOT NULL
      AND "case_key" IS NULL AND "image_key" IS NULL AND "size_cm" IS NULL
      AND "density" IS NULL AND "catalog_version" IS NULL AND "base_case_key" IS NULL
      AND "color_metadata" IS NULL AND "density_metadata" IS NULL)
    OR
    ("phase" IS NOT NULL AND "type" IS NULL AND "area_cm2" IS NULL
      AND "case_key" IS NOT NULL AND "case_key" ~ '^[A-Z][A-Z0-9_]{1,63}$'
      AND "image_key" IS NOT NULL AND btrim("image_key") <> ''
      AND "size_cm" IS NOT NULL AND "density" IS NOT NULL
      AND "catalog_version" IS NOT NULL AND btrim("catalog_version") <> ''
      AND "color_metadata" IS NOT NULL AND jsonb_typeof("color_metadata") = 'object'
      AND "density_metadata" IS NOT NULL AND jsonb_typeof("density_metadata") = 'object'
      AND (("phase" = 'A' AND "base_case_key" IS NULL)
        OR ("phase" = 'B' AND "base_case_key" IS NOT NULL AND "base_case_key" <> "case_key")))
  );

COMMIT;

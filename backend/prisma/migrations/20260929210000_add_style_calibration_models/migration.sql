CREATE TYPE "calibration_case_type" AS ENUM ('AREA', 'COLOR');
CREATE TYPE "pricing_model_status" AS ENUM ('DRAFT', 'ACTIVE', 'SUPERSEDED');

ALTER TABLE "tattoo_artist_accounts"
  ADD COLUMN "adjustment_percent" DECIMAL(7,2) NOT NULL DEFAULT 0;
ALTER TABLE "tattoo_artist_accounts"
  ADD CONSTRAINT "tattoo_artist_accounts_adjustment_percent_check"
  CHECK ("adjustment_percent" > -100 AND "adjustment_percent" <= 1000);

CREATE TABLE "tattoo_styles" (
  "id" UUID NOT NULL,
  "code" VARCHAR(64) NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "tattoo_styles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tattoo_styles_code_key" ON "tattoo_styles"("code");

INSERT INTO "tattoo_styles" ("id", "code", "name") VALUES
  (gen_random_uuid(), 'FINE_LINE', 'Fine Line'),
  (gen_random_uuid(), 'BLACKWORK', 'Blackwork'),
  (gen_random_uuid(), 'REALISM', 'Realism'),
  (gen_random_uuid(), 'AMERICAN_TRADITIONAL', 'American Traditional'),
  (gen_random_uuid(), 'NEO_TRADITIONAL', 'Neo Traditional'),
  (gen_random_uuid(), 'JAPANESE', 'Japanese'),
  (gen_random_uuid(), 'GEOMETRIC', 'Geometric'),
  (gen_random_uuid(), 'WATERCOLOR', 'Watercolor');

CREATE TABLE "artist_styles" (
  "account_id" UUID NOT NULL,
  "style_id" UUID NOT NULL,
  "is_enabled" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "artist_styles_pkey" PRIMARY KEY ("account_id", "style_id"),
  CONSTRAINT "artist_styles_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "tattoo_artist_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "artist_styles_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "tattoo_styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "calibration_cases" (
  "id" UUID NOT NULL,
  "style_id" UUID NOT NULL,
  "image_url" TEXT NOT NULL,
  "type" "calibration_case_type" NOT NULL,
  "area_cm2" DECIMAL(12,2) NOT NULL,
  "color_coverage" DECIMAL(4,3) NOT NULL,
  "display_order" INTEGER NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "calibration_cases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "calibration_cases_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "tattoo_styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "calibration_cases_area_check" CHECK ("area_cm2" > 0),
  CONSTRAINT "calibration_cases_color_check" CHECK ("color_coverage" >= 0 AND "color_coverage" <= 1)
);
CREATE INDEX "calibration_cases_style_id_is_active_display_order_idx" ON "calibration_cases"("style_id", "is_active", "display_order");

CREATE TABLE "pricing_model_versions" (
  "id" UUID NOT NULL,
  "account_id" UUID NOT NULL,
  "style_id" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "pricing_model_status" NOT NULL DEFAULT 'DRAFT',
  "case_snapshot" JSONB NOT NULL,
  "model_parameters" JSONB,
  "adjustment_percent" DECIMAL(7,2) NOT NULL DEFAULT 0,
  "source_version_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "activated_at" TIMESTAMPTZ(3),
  CONSTRAINT "pricing_model_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pricing_model_versions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "tattoo_artist_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pricing_model_versions_style_id_fkey" FOREIGN KEY ("style_id") REFERENCES "tattoo_styles"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pricing_model_versions_source_version_id_fkey" FOREIGN KEY ("source_version_id") REFERENCES "pricing_model_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "pricing_model_versions_version_check" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "pricing_model_versions_account_id_style_id_version_key" ON "pricing_model_versions"("account_id", "style_id", "version");
CREATE INDEX "pricing_model_versions_account_id_style_id_status_idx" ON "pricing_model_versions"("account_id", "style_id", "status");
CREATE UNIQUE INDEX "pricing_model_versions_one_active" ON "pricing_model_versions"("account_id", "style_id") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "pricing_model_versions_one_draft" ON "pricing_model_versions"("account_id", "style_id") WHERE "status" = 'DRAFT';

CREATE TABLE "calibration_answers" (
  "id" UUID NOT NULL,
  "model_version_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "price_pen" DECIMAL(12,2) NOT NULL,
  CONSTRAINT "calibration_answers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "calibration_answers_model_version_id_fkey" FOREIGN KEY ("model_version_id") REFERENCES "pricing_model_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "calibration_answers_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "calibration_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "calibration_answers_price_check" CHECK ("price_pen" > 0)
);
CREATE UNIQUE INDEX "calibration_answers_model_version_id_case_id_key" ON "calibration_answers"("model_version_id", "case_id");

-- Size-based catalog quotes do not require a Vision-derived area.
-- Historical quote values and all existing column types remain intact.
ALTER TABLE "quotes" ALTER COLUMN "target_area_cm2" DROP NOT NULL;
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_area_required_for_existing_algorithms"
  CHECK ("algorithm_version" = 'CATALOG_AB_BILINEAR_DENSITY_V1' OR "target_area_cm2" IS NOT NULL);

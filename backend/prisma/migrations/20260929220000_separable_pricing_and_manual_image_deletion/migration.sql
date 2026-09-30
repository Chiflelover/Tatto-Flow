ALTER TABLE "pricing_model_versions"
  ADD COLUMN "algorithm_version" VARCHAR(64) NOT NULL DEFAULT 'AREA_COLOR_SEPARABLE_V1';

DROP INDEX "lead_images_expires_at_deleted_at_idx";
ALTER TABLE "lead_images"
  DROP COLUMN "expires_at",
  ADD COLUMN "deleted_by_user_id" UUID;
CREATE INDEX "lead_images_deleted_at_idx" ON "lead_images"("deleted_at");
ALTER TABLE "lead_images"
  ADD CONSTRAINT "lead_images_deleted_by_user_id_fkey"
  FOREIGN KEY ("deleted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

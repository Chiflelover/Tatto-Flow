BEGIN;

LOCK TABLE "calibration_cases", "calibration_answers", "pricing_model_versions"
  IN SHARE ROW EXCLUSIVE MODE;

-- Preserve every price and case identifier before detaching answers from the live catalog.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "calibration_answers" a
    JOIN "pricing_model_versions" m ON m."id" = a."model_version_id"
    WHERE NOT (m."case_snapshot" @> jsonb_build_array(jsonb_build_object('id', a."case_id"::text)))
  ) THEN
    RAISE EXCEPTION 'Calibration answers must belong to their model snapshots before retiring cases';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "quotes" q
    JOIN "pricing_model_versions" m ON m."id" = q."pricing_model_version_id"
    JOIN "tattoo_styles" s ON s."id" = m."style_id"
    WHERE s."code" = 'FINE_LINE' AND m."status" = 'DRAFT'
  ) THEN
    RAISE EXCEPTION 'A quoted Fine Line draft requires review before retiring its catalog';
  END IF;
END $$;

ALTER TABLE "calibration_answers" DROP CONSTRAINT "calibration_answers_case_id_fkey";

-- Answers reference frozen case identities, including cases removed from the live catalog.
CREATE FUNCTION "validate_calibration_answer_snapshot"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "pricing_model_versions" m
    WHERE m."id" = NEW."model_version_id"
      AND m."case_snapshot" @> jsonb_build_array(jsonb_build_object('id', NEW."case_id"::text))
  ) THEN
    RAISE EXCEPTION 'Calibration case is absent from the model snapshot'
      USING ERRCODE = '23503', CONSTRAINT = 'calibration_answers_snapshot_case';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "calibration_answers_snapshot_case"
  BEFORE INSERT OR UPDATE OF "case_id", "model_version_id" ON "calibration_answers"
  FOR EACH ROW EXECUTE FUNCTION "validate_calibration_answer_snapshot"();

-- Archive erroneous drafts without changing their answers, parameters or snapshots.
UPDATE "pricing_model_versions" m SET "status" = 'SUPERSEDED'
FROM "tattoo_styles" s
WHERE s."id" = m."style_id" AND s."code" = 'FINE_LINE' AND m."status" = 'DRAFT'
  AND EXISTS (
    SELECT 1 FROM "calibration_cases" c
    WHERE c."style_id" = s."id" AND c."phase" IS NULL
      AND m."case_snapshot" @> jsonb_build_array(jsonb_build_object('id', c."id"::text))
  );

DELETE FROM "calibration_cases" c USING "tattoo_styles" s
WHERE c."style_id" = s."id" AND s."code" = 'FINE_LINE' AND c."phase" IS NULL;

CREATE FUNCTION "validate_fine_line_catalog_phase"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."phase" IS NULL AND EXISTS (
    SELECT 1 FROM "tattoo_styles" s WHERE s."id" = NEW."style_id" AND s."code" = 'FINE_LINE'
  ) THEN
    RAISE EXCEPTION 'Fine Line requires a phased catalog case'
      USING ERRCODE = '23514', CONSTRAINT = 'fine_line_phased_catalog';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "fine_line_phased_catalog"
  BEFORE INSERT OR UPDATE OF "style_id", "phase" ON "calibration_cases"
  FOR EACH ROW EXECUTE FUNCTION "validate_fine_line_catalog_phase"();

COMMIT;

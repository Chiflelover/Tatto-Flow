-- Models produced before AREA_COLOR_SEPARABLE_V1 keep their original identity.
-- Their answers and derived parameters remain untouched.
UPDATE "pricing_model_versions"
SET "algorithm_version" = 'IDW_CONVEX_HULL_V1'
WHERE "model_parameters"->>'algorithm' = 'IDW_CONVEX_HULL_V1';

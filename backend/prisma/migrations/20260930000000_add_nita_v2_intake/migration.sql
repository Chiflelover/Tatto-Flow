-- Additive intake fields: existing conversations retain their flow version and data.
ALTER TYPE "conversation_state" ADD VALUE 'ASK_FIRST_TATTOO';
ALTER TYPE "conversation_state" ADD VALUE 'ASK_SAME_SIZE';
ALTER TYPE "conversation_state" ADD VALUE 'ASK_DESIRED_SIZE_CM';
ALTER TYPE "conversation_state" ADD VALUE 'ASK_COLOR';
ALTER TYPE "conversation_state" ADD VALUE 'READY_FOR_ANALYSIS';

CREATE TYPE "color_declaration" AS ENUM ('BLACK_ONLY', 'BLACK_WITH_SOME_COLOR', 'MOSTLY_COLOR');

ALTER TABLE "conversations"
  ALTER COLUMN "body_part" TYPE VARCHAR(120),
  ADD COLUMN "first_tattoo" BOOLEAN,
  ADD COLUMN "same_size_as_reference" BOOLEAN,
  ADD COLUMN "target_size_cm" DOUBLE PRECISION,
  ADD COLUMN "color_declaration" "color_declaration",
  ADD CONSTRAINT "conversations_target_size_positive" CHECK (
    "target_size_cm" IS NULL OR ("target_size_cm" > 0 AND "target_size_cm" < 'Infinity'::float8)
  ),
  ADD CONSTRAINT "conversations_same_size_without_target" CHECK (
    "same_size_as_reference" IS DISTINCT FROM TRUE OR "target_size_cm" IS NULL
  );

ALTER TABLE "leads"
  ALTER COLUMN "body_part" TYPE VARCHAR(120),
  ADD COLUMN "first_tattoo" BOOLEAN,
  ADD COLUMN "same_size_as_reference" BOOLEAN,
  ADD COLUMN "target_size_cm" DOUBLE PRECISION,
  ADD COLUMN "color_declaration" "color_declaration",
  ADD CONSTRAINT "leads_target_size_positive" CHECK (
    "target_size_cm" IS NULL OR ("target_size_cm" > 0 AND "target_size_cm" < 'Infinity'::float8)
  ),
  ADD CONSTRAINT "leads_same_size_without_target" CHECK (
    "same_size_as_reference" IS DISTINCT FROM TRUE OR "target_size_cm" IS NULL
  );

-- AlterTable
ALTER TABLE "conversations"
ADD COLUMN "selected_size" "tattoo_size",
ADD COLUMN "selected_detail" "detail_level",
ADD COLUMN "body_part" VARCHAR(10);

-- Preserve the order and validity of the conversational draft.
ALTER TABLE "conversations"
ADD CONSTRAINT "conversations_body_part_length" CHECK (
    "body_part" IS NULL OR char_length(btrim("body_part")) BETWEEN 1 AND 10
),
ADD CONSTRAINT "conversations_detail_requires_size" CHECK (
    "selected_detail" IS NULL OR "selected_size" IS NOT NULL
),
ADD CONSTRAINT "conversations_body_part_requires_detail" CHECK (
    "body_part" IS NULL OR "selected_detail" IS NOT NULL
),
ADD CONSTRAINT "conversations_state_requires_size" CHECK (
    "current_state" IN ('START', 'ASK_SIZE') OR "selected_size" IS NOT NULL
),
ADD CONSTRAINT "conversations_state_requires_detail" CHECK (
    "current_state" IN ('START', 'ASK_SIZE', 'ASK_DETAIL') OR "selected_detail" IS NOT NULL
),
ADD CONSTRAINT "conversations_state_requires_body_part" CHECK (
    "current_state" IN ('START', 'ASK_SIZE', 'ASK_DETAIL', 'ASK_BODY_PART') OR "body_part" IS NOT NULL
);

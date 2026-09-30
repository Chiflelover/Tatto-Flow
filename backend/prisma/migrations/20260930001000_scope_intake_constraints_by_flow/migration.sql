-- Scope the original V1 requirements by flow version; keep them for V1.
-- The V2 enum additions are committed by the preceding migration.
ALTER TABLE "conversations"
  DROP CONSTRAINT "conversations_body_part_length",
  DROP CONSTRAINT "conversations_body_part_requires_detail",
  DROP CONSTRAINT "conversations_state_requires_body_part",
  DROP CONSTRAINT "conversations_state_requires_detail",
  DROP CONSTRAINT "conversations_state_requires_size",
  ADD CONSTRAINT "conversations_body_part_length" CHECK (
    "body_part" IS NULL OR char_length(btrim("body_part")) BETWEEN 1 AND 120
  ),
  ADD CONSTRAINT "conversations_body_part_requires_detail" CHECK (
    "flow_version" = 'V2' OR "body_part" IS NULL OR "selected_detail" IS NOT NULL
  ),
  ADD CONSTRAINT "conversations_state_requires_body_part" CHECK (
    "flow_version" = 'V2' OR "current_state" IN ('START', 'ASK_SIZE', 'ASK_DETAIL', 'ASK_BODY_PART') OR "body_part" IS NOT NULL
  ),
  ADD CONSTRAINT "conversations_state_requires_detail" CHECK (
    "flow_version" = 'V2' OR "current_state" IN ('START', 'ASK_SIZE', 'ASK_DETAIL') OR "selected_detail" IS NOT NULL
  ),
  ADD CONSTRAINT "conversations_state_requires_size" CHECK (
    "flow_version" = 'V2' OR "current_state" IN ('START', 'ASK_SIZE') OR "selected_size" IS NOT NULL
  ),
  ADD CONSTRAINT "conversations_states_match_flow" CHECK (
    ("flow_version" = 'V1' AND "current_state" IN ('START', 'ASK_SIZE', 'ASK_DETAIL', 'ASK_BODY_PART', 'WAITING_IMAGE', 'ANALYZING', 'VALIDATING', 'HANDOFF_TO_TATTOO_ARTIST'))
    OR ("flow_version" = 'V2' AND "current_state" IN ('START', 'ASK_FIRST_TATTOO', 'WAITING_IMAGE', 'ASK_SAME_SIZE', 'ASK_DESIRED_SIZE_CM', 'ASK_COLOR', 'ASK_BODY_PART', 'READY_FOR_ANALYSIS'))
  );

ALTER TABLE "leads"
  DROP CONSTRAINT "leads_body_part_length",
  ADD CONSTRAINT "leads_body_part_length" CHECK (
    "body_part" IS NULL OR char_length(btrim("body_part")) BETWEEN 1 AND 120
  );

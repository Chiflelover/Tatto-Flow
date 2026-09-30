-- The preceding migration commits the new enum value before it is used here.
ALTER TABLE "conversations"
  DROP CONSTRAINT "conversations_states_match_flow",
  ADD CONSTRAINT "conversations_states_match_flow" CHECK (
    ("flow_version" = 'V1' AND "current_state" IN ('START', 'ASK_SIZE', 'ASK_DETAIL', 'ASK_BODY_PART', 'WAITING_IMAGE', 'ANALYZING', 'VALIDATING', 'HANDOFF_TO_TATTOO_ARTIST'))
    OR ("flow_version" = 'V2' AND "current_state" IN ('START', 'ASK_FIRST_TATTOO', 'WAITING_IMAGE', 'ASK_SAME_SIZE', 'ASK_DESIRED_SIZE_CM', 'ASK_TARGET_SIZE_AFTER_ANALYSIS', 'INVALID_REFERENCE', 'ASK_COLOR', 'ASK_BODY_PART', 'READY_FOR_ANALYSIS', 'ANALYZING', 'READY_FOR_PRICING', 'HUMAN_REVIEW', 'SPECIAL_REVIEW', 'PRICE_READY', 'ASK_ADVANCE_INTENT', 'HANDOFF_TO_TATTOO_ARTIST'))
  );

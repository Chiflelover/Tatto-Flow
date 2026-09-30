-- The enum additions must be committed before they are used in a CHECK constraint.
ALTER TABLE "conversations"
  DROP CONSTRAINT "conversations_states_match_flow",
  ADD CONSTRAINT "conversations_states_match_flow" CHECK (
    ("flow_version" = 'V1' AND "current_state" IN ('START', 'ASK_SIZE', 'ASK_DETAIL', 'ASK_BODY_PART', 'WAITING_IMAGE', 'ANALYZING', 'VALIDATING', 'HANDOFF_TO_TATTOO_ARTIST'))
    OR ("flow_version" = 'V2' AND "current_state" IN ('START', 'ASK_FIRST_TATTOO', 'WAITING_IMAGE', 'ASK_SAME_SIZE', 'ASK_DESIRED_SIZE_CM', 'ASK_COLOR', 'ASK_BODY_PART', 'READY_FOR_ANALYSIS', 'ANALYZING', 'READY_FOR_PRICING', 'HUMAN_REVIEW', 'SPECIAL_REVIEW'))
  );

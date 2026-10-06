BEGIN;

-- Only the obsolete flow's records are purged. Shared accounts/customers/channels remain.
-- Export any required V1 data and storage paths before deploying this destructive migration.
CREATE TEMP TABLE nita_v1_leads ON COMMIT DROP AS
SELECT l.id FROM leads l
LEFT JOIN conversations c ON c.id = l.conversation_id
LEFT JOIN ai_analyses a ON a.lead_id = l.id
WHERE c.flow_version = 'V1' OR a.analysis_version = 'V1'
   OR l.selected_size IS NOT NULL OR l.selected_detail IS NOT NULL
   OR l.pricing_rule_id IS NOT NULL OR l.calculated_min_price IS NOT NULL
   OR l.calculated_max_price IS NOT NULL OR l.status = 'VERIFIED'
   OR EXISTS (SELECT 1 FROM lead_evaluations e WHERE e.lead_id = l.id);

-- A current quote attached to an obsolete record requires investigation, never silent deletion.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM quotes q JOIN nita_v1_leads l ON l.id = q.lead_id) THEN
    RAISE EXCEPTION 'Current Quote references a Nita V1 lead; resolve this conflict before migration';
  END IF;
END $$;

DELETE FROM leads WHERE id IN (SELECT id FROM nita_v1_leads);
DELETE FROM conversations WHERE flow_version = 'V1';

ALTER TABLE conversations DROP CONSTRAINT conversations_states_match_flow;
ALTER TABLE ai_analyses DROP CONSTRAINT ai_analyses_contract_shape;
ALTER TABLE whatsapp_jobs DROP CONSTRAINT whatsapp_jobs_v2;
ALTER TABLE leads DROP CONSTRAINT leads_pricing_rule_id_fkey;
DROP TABLE lead_evaluations;
DROP TABLE pricing_rule_history;
DROP TABLE pricing_rules;

ALTER TABLE conversations DROP COLUMN flow_version, DROP COLUMN selected_size, DROP COLUMN selected_detail;
ALTER TABLE leads DROP COLUMN selected_size, DROP COLUMN selected_detail,
  DROP COLUMN review_reasons, DROP COLUMN calculated_min_price, DROP COLUMN calculated_max_price,
  DROP COLUMN pricing_rule_id, DROP COLUMN pricing_rule_version, DROP COLUMN price_sent_at;
ALTER TABLE ai_analyses DROP COLUMN analysis_version, DROP COLUMN detected_size,
  DROP COLUMN size_confidence, DROP COLUMN detected_detail, DROP COLUMN detail_confidence;
ALTER TABLE whatsapp_jobs DROP COLUMN flow_version;

ALTER TABLE ai_analyses ADD CONSTRAINT ai_analyses_contract_shape CHECK (
  style_confidence IS NOT NULL AND area_confidence IS NOT NULL
  AND color_confidence IS NOT NULL AND overall_confidence IS NOT NULL
  AND reference_essentially_black IS NOT NULL AND extensive_body_coverage IS NOT NULL
  AND prompt_version IS NOT NULL AND schema_version IS NOT NULL
  AND provider IS NOT NULL AND model IS NOT NULL AND raw_response IS NOT NULL
);

CREATE TYPE conversation_state_current AS ENUM (
  'START', 'ASK_BODY_PART', 'WAITING_IMAGE', 'ANALYZING', 'HANDOFF_TO_TATTOO_ARTIST',
  'ASK_FIRST_TATTOO', 'ASK_SAME_SIZE', 'ASK_DESIRED_SIZE_CM', 'ASK_TARGET_SIZE_AFTER_ANALYSIS',
  'INVALID_REFERENCE', 'ASK_COLOR', 'READY_FOR_ANALYSIS', 'READY_FOR_PRICING',
  'HUMAN_REVIEW', 'SPECIAL_REVIEW', 'PRICE_READY', 'ASK_ADVANCE_INTENT'
);
ALTER TABLE conversations ALTER COLUMN current_state DROP DEFAULT;
ALTER TABLE conversations ALTER COLUMN current_state TYPE conversation_state_current USING current_state::text::conversation_state_current;
DROP TYPE conversation_state;
ALTER TYPE conversation_state_current RENAME TO conversation_state;
ALTER TABLE conversations ALTER COLUMN current_state SET DEFAULT 'START';

CREATE TYPE lead_status_current AS ENUM (
  'ANALYZING', 'REQUIRES_REVIEW', 'HANDOFF_TO_TATTOO_ARTIST', 'COMPLETED',
  'AUTO_QUOTED', 'SPECIAL_REVIEW', 'READY_TO_COORDINATE'
);
ALTER TABLE leads ALTER COLUMN status DROP DEFAULT;
ALTER TABLE leads ALTER COLUMN status TYPE lead_status_current USING status::text::lead_status_current;
DROP TYPE lead_status;
ALTER TYPE lead_status_current RENAME TO lead_status;
ALTER TABLE leads ALTER COLUMN status SET DEFAULT 'ANALYZING';

DROP TYPE flow_version;
DROP TYPE analysis_version;
DROP TYPE tattoo_size;
DROP TYPE detail_level;
DROP TYPE readiness_status;
DROP TYPE review_reason;

COMMIT;

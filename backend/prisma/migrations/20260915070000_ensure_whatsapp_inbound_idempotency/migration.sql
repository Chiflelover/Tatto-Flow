-- Ensure the WhatsApp inbound-message idempotency table exists in deployments
-- that may have been created before the original migration was applied.
CREATE TABLE IF NOT EXISTS "whatsapp_inbound_messages" (
    "message_id" VARCHAR(255) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_inbound_messages_pkey" PRIMARY KEY ("message_id")
);

-- Support retention/operational queries without changing webhook behavior.
CREATE INDEX IF NOT EXISTS "whatsapp_inbound_messages_received_at_idx"
ON "whatsapp_inbound_messages"("received_at");

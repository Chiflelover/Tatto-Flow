-- CreateTable
CREATE TABLE "whatsapp_inbound_messages" (
    "message_id" VARCHAR(255) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_inbound_messages_pkey" PRIMARY KEY ("message_id")
);

-- CreateIndex
CREATE INDEX "whatsapp_inbound_messages_received_at_idx"
ON "whatsapp_inbound_messages"("received_at");

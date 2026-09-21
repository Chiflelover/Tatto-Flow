-- Allow abandoned conversations to preserve an incomplete lead candidate.
ALTER TABLE "leads" ALTER COLUMN "selected_size" DROP NOT NULL;
ALTER TABLE "leads" ALTER COLUMN "selected_detail" DROP NOT NULL;
ALTER TABLE "leads" ALTER COLUMN "body_part" DROP NOT NULL;

-- Logical archive state is independent from the operational lead status.
ALTER TABLE "leads" ADD COLUMN "archived_at" TIMESTAMPTZ(3);

CREATE INDEX "leads_archived_at_idx" ON "leads"("archived_at");

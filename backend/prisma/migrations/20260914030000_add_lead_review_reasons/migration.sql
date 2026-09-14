-- CreateEnum
CREATE TYPE "review_reason" AS ENUM (
    'SIZE_MISMATCH',
    'DETAIL_MISMATCH',
    'LOW_SIZE_CONFIDENCE',
    'LOW_DETAIL_CONFIDENCE',
    'AI_ERROR',
    'PRICING_RULE_NOT_FOUND'
);

-- AlterTable
ALTER TABLE "leads"
ADD COLUMN "review_reasons" "review_reason"[] NOT NULL DEFAULT ARRAY[]::"review_reason"[];

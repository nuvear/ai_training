-- ── Feedback (DATA_MODEL §5) ─────────────────────────────────────────────────
-- Post-cohort reflections. ratings are aggregatable; text_body is the free-text
-- reflection that the M3 privacy boundary (PRODUCT_SPEC §2) must exclude from
-- org-admin views. That boundary is COLUMN-level (aggregate ratings visible,
-- text_body never), which RLS cannot express — so feedback carries NO row-level
-- security (like payment/promo_code in M2) and the exclusion is enforced in the
-- query/service layer (a dedicated org-progress read that never selects
-- text_body). Owner/staff and server code read feedback directly.

-- CreateTable
CREATE TABLE "feedback" (
    "id" UUID NOT NULL,
    "cohort_id" UUID NOT NULL,
    "user_id" UUID,
    "ratings" JSONB NOT NULL DEFAULT '{}',
    "text_body" TEXT,
    "language" "Locale" NOT NULL,
    "ai_theme" TEXT,
    "ai_sentiment" DECIMAL(4,3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "feedback_cohort_id_idx" ON "feedback"("cohort_id");

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_cohort_id_fkey" FOREIGN KEY ("cohort_id") REFERENCES "cohort"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

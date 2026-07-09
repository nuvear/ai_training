-- CreateEnum
CREATE TYPE "OrderKind" AS ENUM ('individual_enrollment', 'seat_pool');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('pending', 'awaiting_transfer', 'paid', 'refunded', 'partially_refunded', 'cancelled');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('JPY', 'USD');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('airwallex_card', 'airwallex_konbini', 'bank_transfer');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'succeeded', 'failed', 'refunded');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('issued', 'paid', 'overdue', 'void');

-- CreateEnum
CREATE TYPE "PromoType" AS ENUM ('percent', 'fixed', 'early_bird', 'seat_limited', 'referral');

-- CreateEnum
CREATE TYPE "PromoCreatedBy" AS ENUM ('human', 'ai_approved');

-- CreateEnum
CREATE TYPE "SeatPoolStatus" AS ENUM ('active', 'exhausted', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "EnrollmentSource" AS ENUM ('self_paid', 'org_seat', 'comp');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('active', 'completed', 'dropped', 'refunded');

-- CreateTable
CREATE TABLE "order" (
    "id" UUID NOT NULL,
    "buyer_user_id" UUID NOT NULL,
    "organization_id" UUID,
    "kind" "OrderKind" NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'pending',
    "currency" "Currency" NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "discount" INTEGER NOT NULL,
    "tax" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "promo_code_id" UUID,
    "utm" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_item" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "cohort_id" UUID,
    "seat_pool_spec" JSONB,
    "qty" INTEGER NOT NULL,
    "unit_price" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "provider_ref" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "amount" INTEGER NOT NULL,
    "received_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "qualified_invoice_no" TEXT,
    "pdf_storage_key" TEXT,
    "due_at" TIMESTAMP(3) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'issued',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_code" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "type" "PromoType" NOT NULL,
    "value" INTEGER NOT NULL,
    "currency" "Currency",
    "max_redemptions" INTEGER,
    "redeemed_count" INTEGER NOT NULL DEFAULT 0,
    "valid_from" TIMESTAMP(3),
    "valid_until" TIMESTAMP(3),
    "cohort_scope" UUID[],
    "created_by" "PromoCreatedBy" NOT NULL DEFAULT 'human',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promo_code_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seat_pool" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "seats_total" INTEGER NOT NULL,
    "seats_used" INTEGER NOT NULL DEFAULT 0,
    "valid_until" TIMESTAMP(3) NOT NULL,
    "status" "SeatPoolStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seat_pool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "approved_by" UUID,
    "ai_action_id" UUID,
    "provider_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollment" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "cohort_id" UUID NOT NULL,
    "source" "EnrollmentSource" NOT NULL,
    "seat_pool_id" UUID,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'active',
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_buyer_user_id_idx" ON "order"("buyer_user_id");

-- CreateIndex
CREATE INDEX "order_organization_id_idx" ON "order"("organization_id");

-- CreateIndex
CREATE INDEX "order_status_idx" ON "order"("status");

-- CreateIndex
CREATE INDEX "order_item_order_id_idx" ON "order_item"("order_id");

-- CreateIndex
CREATE INDEX "order_item_cohort_id_idx" ON "order_item"("cohort_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_provider_ref_key" ON "payment"("provider_ref");

-- CreateIndex
CREATE INDEX "payment_order_id_idx" ON "payment"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_order_id_key" ON "invoice"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_number_key" ON "invoice"("number");

-- CreateIndex
CREATE INDEX "invoice_organization_id_idx" ON "invoice"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "promo_code_code_key" ON "promo_code"("code");

-- CreateIndex
CREATE UNIQUE INDEX "seat_pool_order_id_key" ON "seat_pool"("order_id");

-- CreateIndex
CREATE INDEX "seat_pool_organization_id_idx" ON "seat_pool"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "refund_provider_ref_key" ON "refund"("provider_ref");

-- CreateIndex
CREATE INDEX "refund_payment_id_idx" ON "refund"("payment_id");

-- CreateIndex
CREATE INDEX "enrollment_cohort_id_idx" ON "enrollment"("cohort_id");

-- CreateIndex
CREATE INDEX "enrollment_seat_pool_id_idx" ON "enrollment"("seat_pool_id");

-- CreateIndex
CREATE UNIQUE INDEX "enrollment_user_id_cohort_id_key" ON "enrollment"("user_id", "cohort_id");

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_buyer_user_id_fkey" FOREIGN KEY ("buyer_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "promo_code"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_cohort_id_fkey" FOREIGN KEY ("cohort_id") REFERENCES "cohort"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice" ADD CONSTRAINT "invoice_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_pool" ADD CONSTRAINT "seat_pool_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_pool" ADD CONSTRAINT "seat_pool_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_ai_action_id_fkey" FOREIGN KEY ("ai_action_id") REFERENCES "ai_action"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_cohort_id_fkey" FOREIGN KEY ("cohort_id") REFERENCES "cohort"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment" ADD CONSTRAINT "enrollment_seat_pool_id_fkey" FOREIGN KEY ("seat_pool_id") REFERENCES "seat_pool"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Provider note (DATA_MODEL §4) ────────────────────────────────────────────
-- DATA_MODEL §4 lists payment providers as stripe_card / stripe_konbini. The
-- owner selected Airwallex as the PSP, so PaymentProvider ships as airwallex_card
-- / airwallex_konbini / bank_transfer. The model shape (idempotency on
-- provider_ref, manual/webhook bank-transfer reconciliation) is unchanged.

-- ── CHECK constraints (DATA_MODEL §8) ────────────────────────────────────────
-- A seat pool can never consume more seats than it holds.
ALTER TABLE "seat_pool"
  ADD CONSTRAINT "seat_pool_seats_used_lte_total"
  CHECK ("seats_used" <= "seats_total");

-- Order money is stored as non-negative integer minor units; totals are computed
-- server-side, never negative.
ALTER TABLE "order"
  ADD CONSTRAINT "order_amounts_non_negative"
  CHECK ("subtotal" >= 0 AND "discount" >= 0 AND "tax" >= 0 AND "total" >= 0);

-- Redemptions are non-negative and never exceed the cap when one is set. This is
-- also enforced in-transaction by app code (DATA_MODEL §8), but the DB is the
-- backstop.
ALTER TABLE "promo_code"
  ADD CONSTRAINT "promo_code_redeemed_count_non_negative"
  CHECK ("redeemed_count" >= 0);
ALTER TABLE "promo_code"
  ADD CONSTRAINT "promo_code_redeemed_within_max"
  CHECK ("max_redemptions" IS NULL OR "redeemed_count" <= "max_redemptions");

-- ── Row-level security (CLAUDE.md invariant 8, DATA_MODEL §2) ─────────────────
-- Reuses the app_current_* accessors from 20260707230000_rls_grants_guards.
-- owner/staff operate the whole business; org_admin/participant are confined to
-- their organization; a buyer can always see their own orders/enrollments.
-- order_item / payment / promo_code / refund are intentionally left without RLS:
-- they are reached through their RLS-protected parent by staff/owner and server
-- code, never queried cross-tenant by org-scoped roles.

ALTER TABLE "order" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "order_isolation" ON "order"
  USING (
    app_current_role() IN ('owner', 'staff')
    OR buyer_user_id = app_current_user()
    OR organization_id = app_current_org()
  );

ALTER TABLE "invoice" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invoice_isolation" ON "invoice"
  USING (
    app_current_role() IN ('owner', 'staff')
    OR organization_id = app_current_org()
  );

ALTER TABLE "seat_pool" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "seat_pool_isolation" ON "seat_pool"
  USING (
    app_current_role() IN ('owner', 'staff')
    OR organization_id = app_current_org()
  );

ALTER TABLE "enrollment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "enrollment_isolation" ON "enrollment"
  USING (
    app_current_role() IN ('owner', 'staff')
    OR user_id = app_current_user()
  );

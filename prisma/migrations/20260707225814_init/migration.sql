-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('owner', 'staff', 'org_admin', 'participant');

-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('en', 'ja');

-- CreateEnum
CREATE TYPE "BillingMethod" AS ENUM ('card', 'invoice_transfer');

-- CreateEnum
CREATE TYPE "AiSurface" AS ENUM ('copilot', 'concierge', 'scheduler');

-- CreateEnum
CREATE TYPE "AiTier" AS ENUM ('auto', 'approve', 'owner_only');

-- CreateEnum
CREATE TYPE "AiActionStatus" AS ENUM ('proposed', 'approved', 'executed', 'rejected', 'rolled_back', 'failed');

-- CreateTable
CREATE TABLE "organization" (
    "id" UUID NOT NULL,
    "name" JSONB NOT NULL,
    "billing_email" TEXT NOT NULL,
    "billing_method" "BillingMethod" NOT NULL DEFAULT 'card',
    "invoice_registration_no" TEXT,
    "locale" "Locale" NOT NULL DEFAULT 'ja',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" JSONB NOT NULL DEFAULT '{}',
    "role" "Role" NOT NULL DEFAULT 'participant',
    "organization_id" UUID,
    "locale" "Locale" NOT NULL DEFAULT 'ja',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Tokyo',
    "notification_prefs" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "magic_link_token" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "magic_link_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_action" (
    "id" UUID NOT NULL,
    "parent_id" UUID,
    "initiated_by" UUID,
    "surface" "AiSurface" NOT NULL,
    "tool_name" TEXT NOT NULL,
    "tier" "AiTier" NOT NULL,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "status" "AiActionStatus" NOT NULL DEFAULT 'proposed',
    "approved_by" UUID,
    "reversal_of" UUID,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_action_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "embedding" (
    "id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "locale" "Locale" NOT NULL,
    "vector" vector(1536) NOT NULL,
    "text_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "embedding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "user_organization_id_idx" ON "user"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "magic_link_token_token_hash_key" ON "magic_link_token"("token_hash");

-- CreateIndex
CREATE INDEX "magic_link_token_email_idx" ON "magic_link_token"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ai_action_idempotency_key_key" ON "ai_action"("idempotency_key");

-- CreateIndex
CREATE INDEX "ai_action_status_idx" ON "ai_action"("status");

-- CreateIndex
CREATE INDEX "ai_action_tool_name_idx" ON "ai_action"("tool_name");

-- CreateIndex
CREATE INDEX "ai_action_parent_id_idx" ON "ai_action"("parent_id");

-- CreateIndex
CREATE INDEX "embedding_entity_type_idx" ON "embedding"("entity_type");

-- CreateIndex
CREATE UNIQUE INDEX "embedding_entity_type_entity_id_locale_key" ON "embedding"("entity_type", "entity_id", "locale");

-- AddForeignKey
ALTER TABLE "user" ADD CONSTRAINT "user_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_action" ADD CONSTRAINT "ai_action_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "ai_action"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_action" ADD CONSTRAINT "ai_action_initiated_by_fkey" FOREIGN KEY ("initiated_by") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_action" ADD CONSTRAINT "ai_action_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

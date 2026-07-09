-- CreateEnum
CREATE TYPE "WorkshopLevel" AS ENUM ('intro', 'intermediate', 'advanced');

-- CreateEnum
CREATE TYPE "WorkshopStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "CohortStatus" AS ENUM ('open', 'full', 'running', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "CohortFormat" AS ENUM ('online', 'in_person', 'hybrid');

-- CreateEnum
CREATE TYPE "ContentKind" AS ENUM ('slide', 'doc', 'video', 'prework');

-- CreateEnum
CREATE TYPE "WaitlistStatus" AS ENUM ('waiting', 'offered', 'confirmed', 'expired');

-- CreateEnum
CREATE TYPE "LocalizationState" AS ENUM ('ai_localized', 'human_reviewed');

-- CreateTable
CREATE TABLE "workshop" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "description" JSONB NOT NULL DEFAULT '{}',
    "outcomes" JSONB NOT NULL DEFAULT '{}',
    "level" "WorkshopLevel" NOT NULL DEFAULT 'intro',
    "status" "WorkshopStatus" NOT NULL DEFAULT 'draft',
    "completion_rule" JSONB NOT NULL DEFAULT '{"attendance_pct":80,"quiz_pass_pct":70}',
    "localization_review" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workshop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cohort" (
    "id" UUID NOT NULL,
    "workshop_id" UUID NOT NULL,
    "status" "CohortStatus" NOT NULL DEFAULT 'open',
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "price_jpy" INTEGER,
    "price_usd" INTEGER,
    "format" "CohortFormat" NOT NULL DEFAULT 'online',
    "venue" JSONB,
    "meeting_url" TEXT,
    "facilitator_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cohort_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" UUID NOT NULL,
    "cohort_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "agenda" JSONB NOT NULL DEFAULT '{}',
    "materials" JSONB NOT NULL DEFAULT '[]',
    "checkin_token" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_item" (
    "id" UUID NOT NULL,
    "workshop_id" UUID NOT NULL,
    "kind" "ContentKind" NOT NULL,
    "title" JSONB NOT NULL,
    "storage_key" TEXT,
    "locale_variants" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workshop_skill" (
    "workshop_id" UUID NOT NULL,
    "skill_id" UUID NOT NULL,
    "weight" DECIMAL(4,2) NOT NULL DEFAULT 1,

    CONSTRAINT "workshop_skill_pkey" PRIMARY KEY ("workshop_id","skill_id")
);

-- CreateTable
CREATE TABLE "waitlist_entry" (
    "id" UUID NOT NULL,
    "cohort_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "ai_attend_score" DECIMAL(5,4),
    "promoted_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "status" "WaitlistStatus" NOT NULL DEFAULT 'waiting',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "waitlist_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workshop_slug_key" ON "workshop"("slug");

-- CreateIndex
CREATE INDEX "workshop_status_idx" ON "workshop"("status");

-- CreateIndex
CREATE INDEX "cohort_workshop_id_idx" ON "cohort"("workshop_id");

-- CreateIndex
CREATE INDEX "cohort_status_idx" ON "cohort"("status");

-- CreateIndex
CREATE INDEX "session_cohort_id_idx" ON "session"("cohort_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_cohort_id_seq_key" ON "session"("cohort_id", "seq");

-- CreateIndex
CREATE INDEX "content_item_workshop_id_idx" ON "content_item"("workshop_id");

-- CreateIndex
CREATE UNIQUE INDEX "skill_slug_key" ON "skill"("slug");

-- CreateIndex
CREATE INDEX "workshop_skill_skill_id_idx" ON "workshop_skill"("skill_id");

-- CreateIndex
CREATE INDEX "waitlist_entry_cohort_id_status_idx" ON "waitlist_entry"("cohort_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "waitlist_entry_cohort_id_user_id_key" ON "waitlist_entry"("cohort_id", "user_id");

-- AddForeignKey
ALTER TABLE "cohort" ADD CONSTRAINT "cohort_workshop_id_fkey" FOREIGN KEY ("workshop_id") REFERENCES "workshop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cohort" ADD CONSTRAINT "cohort_facilitator_id_fkey" FOREIGN KEY ("facilitator_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_cohort_id_fkey" FOREIGN KEY ("cohort_id") REFERENCES "cohort"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_item" ADD CONSTRAINT "content_item_workshop_id_fkey" FOREIGN KEY ("workshop_id") REFERENCES "workshop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_skill" ADD CONSTRAINT "workshop_skill_workshop_id_fkey" FOREIGN KEY ("workshop_id") REFERENCES "workshop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workshop_skill" ADD CONSTRAINT "workshop_skill_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entry" ADD CONSTRAINT "waitlist_entry_cohort_id_fkey" FOREIGN KEY ("cohort_id") REFERENCES "cohort"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entry" ADD CONSTRAINT "waitlist_entry_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DATA_MODEL §8: partial index for catalog queries over bookable cohorts.
CREATE INDEX "cohort_open_status_idx" ON "cohort" ("status") WHERE "status" IN ('open', 'full');

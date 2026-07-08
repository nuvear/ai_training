-- CreateEnum
CREATE TYPE "LandingStatus" AS ENUM ('ai_draft', 'approved', 'live', 'retired');

-- CreateEnum
CREATE TYPE "CampaignKind" AS ENUM ('announce', 'reminder', 'last_seats');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('draft', 'approved', 'running', 'done');

-- CreateTable
CREATE TABLE "landing_page" (
    "id" UUID NOT NULL,
    "workshop_id" UUID NOT NULL,
    "locale" "Locale" NOT NULL,
    "variant" CHAR(1) NOT NULL,
    "content" JSONB NOT NULL DEFAULT '{}',
    "status" "LandingStatus" NOT NULL DEFAULT 'ai_draft',
    "traffic_weight" DECIMAL(4,3) NOT NULL DEFAULT 0.5,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "landing_page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign" (
    "id" UUID NOT NULL,
    "cohort_id" UUID NOT NULL,
    "kind" "CampaignKind" NOT NULL,
    "sequence" JSONB NOT NULL DEFAULT '[]',
    "status" "CampaignStatus" NOT NULL DEFAULT 'draft',
    "scheduled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_send" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "user_id" UUID,
    "email" TEXT NOT NULL,
    "locale" "Locale" NOT NULL,
    "sent_at" TIMESTAMP(3),
    "opened_at" TIMESTAMP(3),
    "clicked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_send_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attribution_visit" (
    "id" UUID NOT NULL,
    "session_key" TEXT NOT NULL,
    "utm" JSONB NOT NULL DEFAULT '{}',
    "referrer" TEXT,
    "landing_page_id" UUID,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attribution_visit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "landing_page_workshop_id_idx" ON "landing_page"("workshop_id");

-- CreateIndex
CREATE INDEX "campaign_cohort_id_idx" ON "campaign"("cohort_id");

-- CreateIndex
CREATE INDEX "campaign_send_campaign_id_idx" ON "campaign_send"("campaign_id");

-- CreateIndex
CREATE INDEX "attribution_visit_session_key_idx" ON "attribution_visit"("session_key");

-- AddForeignKey
ALTER TABLE "landing_page" ADD CONSTRAINT "landing_page_workshop_id_fkey" FOREIGN KEY ("workshop_id") REFERENCES "workshop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_cohort_id_fkey" FOREIGN KEY ("cohort_id") REFERENCES "cohort"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_send" ADD CONSTRAINT "campaign_send_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attribution_visit" ADD CONSTRAINT "attribution_visit_landing_page_id_fkey" FOREIGN KEY ("landing_page_id") REFERENCES "landing_page"("id") ON DELETE SET NULL ON UPDATE CASCADE;

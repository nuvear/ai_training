-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('present', 'absent', 'excused');

-- CreateEnum
CREATE TYPE "AttendanceMethod" AS ENUM ('facilitator', 'self_checkin', 'auto_join');

-- CreateEnum
CREATE TYPE "QuizStatus" AS ENUM ('ai_draft', 'published');

-- CreateEnum
CREATE TYPE "ProgressEventKind" AS ENUM ('prework_done', 'session_attended', 'quiz_passed', 'nudge_sent', 'completed');

-- CreateTable
CREATE TABLE "attendance" (
    "id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "status" "AttendanceStatus" NOT NULL,
    "method" "AttendanceMethod" NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz" (
    "id" UUID NOT NULL,
    "workshop_id" UUID NOT NULL,
    "title" JSONB NOT NULL,
    "pass_pct" INTEGER NOT NULL DEFAULT 70,
    "status" "QuizStatus" NOT NULL DEFAULT 'ai_draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quiz_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_question" (
    "id" UUID NOT NULL,
    "quiz_id" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "prompt" JSONB NOT NULL,
    "options" JSONB NOT NULL,
    "correct_key" TEXT NOT NULL,
    "explanation" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quiz_question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_attempt" (
    "id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "quiz_id" UUID NOT NULL,
    "answers" JSONB NOT NULL,
    "score_pct" INTEGER NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "attempted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quiz_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificate" (
    "id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "verify_code" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pdf_storage_key_en" TEXT,
    "pdf_storage_key_ja" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "certificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progress_event" (
    "id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "kind" "ProgressEventKind" NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "progress_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_session_id_idx" ON "attendance"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_enrollment_id_session_id_key" ON "attendance"("enrollment_id", "session_id");

-- CreateIndex
CREATE INDEX "quiz_workshop_id_idx" ON "quiz"("workshop_id");

-- CreateIndex
CREATE UNIQUE INDEX "quiz_question_quiz_id_seq_key" ON "quiz_question"("quiz_id", "seq");

-- CreateIndex
CREATE INDEX "quiz_attempt_enrollment_id_idx" ON "quiz_attempt"("enrollment_id");

-- CreateIndex
CREATE UNIQUE INDEX "certificate_enrollment_id_key" ON "certificate"("enrollment_id");

-- CreateIndex
CREATE UNIQUE INDEX "certificate_verify_code_key" ON "certificate"("verify_code");

-- CreateIndex
CREATE INDEX "progress_event_enrollment_id_idx" ON "progress_event"("enrollment_id");

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz" ADD CONSTRAINT "quiz_workshop_id_fkey" FOREIGN KEY ("workshop_id") REFERENCES "workshop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_question" ADD CONSTRAINT "quiz_question_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_attempt" ADD CONSTRAINT "quiz_attempt_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_attempt" ADD CONSTRAINT "quiz_attempt_quiz_id_fkey" FOREIGN KEY ("quiz_id") REFERENCES "quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificate" ADD CONSTRAINT "certificate_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progress_event" ADD CONSTRAINT "progress_event_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Append-only guard on progress_event (DATA_MODEL §5) ──────────────────────
-- Like ai_action, progress_event is an immutable stream: deletes are forbidden.
-- Reuses the forbid_delete() trigger function created in the rls_grants_guards
-- migration.
CREATE TRIGGER "progress_event_no_delete" BEFORE DELETE ON "progress_event"
  FOR EACH ROW EXECUTE FUNCTION forbid_delete();

-- ── Row-level security (CLAUDE.md invariant 8, DATA_MODEL §2/§5) ──────────────
-- owner/staff operate the business and see every org's participant data; a
-- participant sees only rows tied to their own enrollments. quiz / quiz_question
-- are intentionally left WITHOUT RLS: published quizzes are workshop-global
-- content read by staff and participants alike, with access controlled in the
-- service layer. Public certificate verification (by verify_code) runs as the
-- owner connection and so is unaffected by these policies.

ALTER TABLE "attendance" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "attendance_isolation" ON "attendance"
  USING (
    app_current_role() IN ('owner', 'staff')
    OR enrollment_id IN (SELECT id FROM enrollment WHERE user_id = app_current_user())
  );

ALTER TABLE "quiz_attempt" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quiz_attempt_isolation" ON "quiz_attempt"
  USING (
    app_current_role() IN ('owner', 'staff')
    OR enrollment_id IN (SELECT id FROM enrollment WHERE user_id = app_current_user())
  );

ALTER TABLE "certificate" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "certificate_isolation" ON "certificate"
  USING (
    app_current_role() IN ('owner', 'staff')
    OR enrollment_id IN (SELECT id FROM enrollment WHERE user_id = app_current_user())
  );

ALTER TABLE "progress_event" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "progress_event_isolation" ON "progress_event"
  USING (
    app_current_role() IN ('owner', 'staff')
    OR enrollment_id IN (SELECT id FROM enrollment WHERE user_id = app_current_user())
  );

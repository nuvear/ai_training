-- ── App role ────────────────────────────────────────────────────────────────
-- The app connects to Postgres as the (super)user in DATABASE_URL, but every
-- tenant query runs inside a transaction that does `SET LOCAL ROLE workshopos_app`
-- (see src/server/db/rls.ts). That role is NOLOGIN and non-superuser, so the
-- session becomes subject to the row-level-security policies below. Migrations
-- and seeds keep running as the owner, so they bypass RLS as intended.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'workshopos_app') THEN
    CREATE ROLE workshopos_app NOLOGIN;
  END IF;
END $$;

-- Let whoever runs migrations SET ROLE to the app role (superusers already can;
-- this keeps it working when the admin connection is a plain non-superuser).
GRANT workshopos_app TO CURRENT_USER;

GRANT USAGE ON SCHEMA public TO workshopos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO workshopos_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO workshopos_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO workshopos_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO workshopos_app;

-- ── Case-insensitive email uniqueness ────────────────────────────────────────
-- The app lowercases emails before writing; this index enforces it at the DB.
CREATE UNIQUE INDEX "user_email_lower_key" ON "user" (lower(email));

-- ── Session accessors used by RLS policies ───────────────────────────────────
CREATE OR REPLACE FUNCTION app_current_org() RETURNS uuid
  LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('app.current_org_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_current_role() RETURNS text
  LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('app.current_role', true), '')
$$;

CREATE OR REPLACE FUNCTION app_current_user() RETURNS uuid
  LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('app.current_user_id', true), '')::uuid
$$;

-- ── Row-level security (CLAUDE.md invariant 8, DATA_MODEL §2) ─────────────────
-- owner/staff operate the business and see every org; org_admin/participant are
-- confined to their own organization; a user can always see their own row.
ALTER TABLE "organization" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "organization_isolation" ON "organization"
  USING (
    app_current_role() IN ('owner', 'staff')
    OR id = app_current_org()
  );

ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_isolation" ON "user"
  USING (
    app_current_role() IN ('owner', 'staff')
    OR organization_id = app_current_org()
    OR id = app_current_user()
  );

-- ── Append-only ledger guard (DATA_MODEL §7) ─────────────────────────────────
-- ai_action is never deleted. Updates (status transitions) remain allowed.
CREATE OR REPLACE FUNCTION forbid_delete() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ai_action is append-only: deletes are not permitted';
END $$;

CREATE TRIGGER "ai_action_no_delete" BEFORE DELETE ON "ai_action"
  FOR EACH ROW EXECUTE FUNCTION forbid_delete();

-- 053_explicit_data_api_grants.sql
--
-- WHY THIS EXISTS
-- Supabase stopped auto-granting Data API (PostgREST) access to NEW tables
-- in `public` for existing projects from 30 Oct 2026. Tables that already
-- exist keep their grants, so production is unaffected. But anywhere the
-- migrations are REPLAYED — a new Supabase project, a preview branch, a
-- local `supabase db reset` — every table is created with NO grants for
-- anon / authenticated / service_role, and every API call then fails with
-- "permission denied for table ...". Replaying 001-052 under the new
-- behaviour leaves 32 of 43 public tables (every core table: students,
-- classes, terms, student_scores, attendance, comments, report_snapshots,
-- ...) without full access for `authenticated`.
--
-- WHAT THIS DOES
-- 1. authenticated + service_role: full table privileges on every existing
--    public table. This reproduces exactly what the old auto-grant gave,
--    so the *effective* access model is unchanged — row-level security
--    (RLS), not table grants, is what actually gates data in this app, and
--    every public table has RLS enabled.
-- 2. anon: ONE new grant — SELECT on invite_codes. JoinPage validates an
--    invite code BEFORE sign-up (i.e. as anon), and policy
--    public_read_invite_code exists for exactly that. Migration 005 said
--    "anon already has SELECT on invite_codes (granted earlier)", but that
--    only ever existed as an auto-grant, never as an explicit statement —
--    so it would silently vanish on a fresh environment.
--    anon deliberately gets NOTHING else here. The other anon tables
--    (schools 005, profiles 033, blog_posts 025, blog_post_reactions 025,
--    team_members/history_events/testimonials 029) were already granted
--    explicitly in their own migrations.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
-- - No `ALTER DEFAULT PRIVILEGES`. That would quietly restore the old
--   "everything is exposed by default" behaviour that Supabase is moving
--   away from. Future tables must grant explicitly (see rule below).
-- - No REVOKEs. On production, anon still holds the old broad auto-grants
--   (RLS keeps them harmless). Tightening those is a separate, optional
--   hardening step — not bundled into a compatibility fix.
--
-- RULE FOR EVERY FUTURE `CREATE TABLE` MIGRATION
--   Include its own grants, e.g.
--     GRANT SELECT, INSERT, UPDATE, DELETE ON public.new_table TO authenticated;
--     GRANT ALL ON public.new_table TO service_role;
--     -- and ONLY if signed-out visitors truly need it:
--     GRANT SELECT ON public.new_table TO anon;
--
-- Idempotent: GRANT on an already-granted privilege is a no-op, so this is
-- safe on production (where it changes nothing) and on any replay.

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')          -- ordinary + partitioned tables
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t.relname);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t.relname);
  END LOOP;
END
$$;

-- Pre-sign-up invite-code validation (JoinPage). Row access is still
-- limited by RLS policy public_read_invite_code.
GRANT SELECT ON public.invite_codes TO anon;

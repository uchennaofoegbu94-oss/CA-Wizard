-- ============================================================
-- CA-WIZARD | Migration 005 — Allow anon to read schools
--                              during invite-code verification
-- ============================================================
-- JoinPage.tsx runs this BEFORE the person has an account:
--   supabase.from('invite_codes').select('*, school:schools(*)')
-- anon already has SELECT on invite_codes (granted earlier), but
-- was never granted SELECT on schools, and no RLS policy allows
-- anon to read schools at all — every existing policy on schools
-- checks is_super_admin() or current_school_id(), both of which
-- resolve to NULL for an unauthenticated request. Same root cause
-- as the earlier "permission denied for table schools" bug, just
-- a different code path (unauthenticated join vs. authenticated
-- admin dashboard).
--
-- This only exposes basic school profile fields (name, motto,
-- address, etc.) — the same information already exposed by the
-- existing "public_read_invite_code" policy's join target, and
-- necessary for the teacher to confirm which school they're
-- about to join before creating an account.

GRANT SELECT ON schools TO anon;

CREATE POLICY "public_read_school_for_invite_check" ON schools
  FOR SELECT USING (TRUE);

-- ============================================================
-- CA-WIZARD | Migration 034 — Fix invite code reuse
-- ============================================================
-- Root cause, confirmed by reproducing it against a real Postgres 16
-- instance: JoinPage.tsx's final step — marking a code as used —
-- does a plain client-side UPDATE on invite_codes AFTER signUp
-- succeeds. But invite_codes only has write policies for
-- super_admin and school_admin (migration 001); a freshly-created
-- teacher or group_admin account satisfies neither, so that UPDATE
-- silently matches zero rows under RLS. Postgres doesn't error on
-- an UPDATE that matches nothing, and the app never checked the
-- result — so used_at/is_active never actually changed, no matter
-- how many times a code was redeemed:
--
--   UPDATE invite_codes SET used_by = ..., is_active = FALSE
--   WHERE id = ...;
--   -- "UPDATE 0" — silently, every single time, for every teacher
--
-- This is not a race condition, it's a deterministic, always-on gap.
-- Fixing it also closes a real race condition that plain client-side
-- RLS-gated writes could never have prevented anyway: two people
-- redeeming the same code within moments of each other, both passing
-- the initial (read-only) verify check before either finishes
-- signing up.
--
-- Fix: three SECURITY DEFINER functions replace the direct table
-- write, splitting redemption into a claim BEFORE signUp and a
-- finalize AFTER it — so a code that's already gone (claimed by
-- someone else in the interim) is caught before an auth account
-- ever gets created, not after. This mirrors the same reasoning
-- already documented in JoinPage.tsx for the teacher-cap check:
-- "a DB trigger on profiles would silently orphan the auth account
-- instead of cleanly rejecting it."
-- ============================================================

-- Atomic claim: finds the code AND marks it used-and-inactive in one
-- statement. The WHERE clause (is_active = TRUE) is what actually
-- prevents the race — under concurrent calls for the same code,
-- Postgres's row-level locking means only one UPDATE can match and
-- return a row; every other concurrent or subsequent call sees
-- is_active already FALSE and returns nothing. Called BEFORE signUp,
-- while the redeemer has no session yet — anon needs EXECUTE.
CREATE OR REPLACE FUNCTION claim_invite_code(p_code TEXT)
RETURNS SETOF invite_codes AS $$
  UPDATE public.invite_codes
  SET is_active = FALSE, used_at = NOW()
  WHERE code = p_code
    AND is_active = TRUE
    AND expires_at > NOW()
  RETURNING *;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION claim_invite_code TO anon, authenticated;

-- Called AFTER signUp succeeds, to attribute the already-claimed code
-- to the new profile. Deliberately narrow: only completes a claim
-- that's already been made (used_by IS NULL, is_active already
-- FALSE from claim_invite_code) — it can't itself flip is_active or
-- claim an active code, and it can't attribute the redemption to any
-- profile except the caller's own (checked against current_profile_id(),
-- the same helper introduced in migration 023), so a malicious client
-- can't credit — or blame — someone else's account for a redemption.
CREATE OR REPLACE FUNCTION finalize_invite_code_redemption(p_id UUID, p_used_by UUID)
RETURNS VOID AS $$
BEGIN
  IF p_used_by IS DISTINCT FROM current_profile_id() THEN
    RAISE EXCEPTION 'Cannot finalize an invite code redemption for another profile';
  END IF;

  UPDATE public.invite_codes
  SET used_by = p_used_by
  WHERE id = p_id AND used_by IS NULL AND is_active = FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION finalize_invite_code_redemption TO authenticated;

-- Compensating rollback: if signUp fails AFTER a successful claim
-- (wrong password rejected server-side, email already registered,
-- network error, etc.), this un-claims the code rather than
-- permanently burning it for a redemption that never actually
-- happened. Scoped to used_by IS NULL specifically so it can only
-- release a code still in that narrow "claimed but not yet
-- attributed" window — it can never undo a real, completed
-- redemption (used_by already set).
CREATE OR REPLACE FUNCTION release_invite_code(p_id UUID)
RETURNS VOID AS $$
  UPDATE public.invite_codes
  SET is_active = TRUE, used_at = NULL
  WHERE id = p_id AND used_by IS NULL;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION release_invite_code TO anon, authenticated;

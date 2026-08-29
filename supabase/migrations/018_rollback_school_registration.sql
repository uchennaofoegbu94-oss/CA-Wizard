-- ============================================================
-- 018: rollback for failed school registration
-- ============================================================
-- RegisterSchoolPage.tsx creates the school (Step 1, via
-- register_school_public) BEFORE creating the actual admin login
-- account (Step 2, via supabase.auth.signUp). If Step 2 fails for any
-- reason — a malformed email that passes client-side Zod validation
-- but fails Supabase Auth's own stricter server-side check, a rate
-- limit, a network blip — the school from Step 1 was already
-- committed, and nothing ever cleaned it up. That's the reported bug:
-- "school created but email is invalid."
--
-- This function is the cleanup half of the fix (the client-side half
-- is calling it from the signUp error handler). It's deliberately
-- narrow: only deletes a school if it is STILL 'pending' AND has
-- literally zero profiles ever attached to it. A real school —
-- anything approved, or anything with even one profile row (meaning
-- Step 2 DID succeed for someone at some point) — can never be
-- touched by this function, regardless of who calls it or with what
-- id. That's what makes it safe to expose to anon/unauthenticated
-- callers, the same trust boundary register_school_public itself
-- already operates under.

CREATE OR REPLACE FUNCTION rollback_pending_school_registration(p_school_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM schools
  WHERE id = p_school_id
    AND status = 'pending'
    AND NOT EXISTS (SELECT 1 FROM profiles WHERE profiles.school_id = p_school_id);
END;
$$;

GRANT EXECUTE ON FUNCTION rollback_pending_school_registration TO anon, authenticated;

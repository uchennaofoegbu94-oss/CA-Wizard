-- ============================================================
-- 046: Starter tier student limit revision (100 -> 49)
-- ============================================================
-- Pricing page revision: Starter is now ₦1,999/mo, capped at 49
-- active students and 9 teacher accounts (previously 100 students,
-- 3 teachers — see the same commit's changes to
-- src/lib/tierLimits.ts and src/pages/marketing/LandingPage.tsx).
--
-- Only the STUDENT limit needs a database change: tier_student_limit()
-- backs an actual BEFORE INSERT trigger on students
-- (enforce_student_tier_limit, from migration 020) — this is the real,
-- unbypassable enforcement, not just a UI number.
--
-- The teacher limit does NOT get a matching database function here —
-- per migration 020's own note, teacher caps are deliberately
-- client-side only (enforced in JoinPage.tsx before signUp() is ever
-- called, via src/lib/tierLimits.ts's teacherLimit()), because a
-- BEFORE INSERT trigger on profiles would fire inside
-- handle_new_user()'s exception-swallowing handler and risk silently
-- orphaning the auth account instead of cleanly rejecting the invite.
-- That constraint hasn't changed, so the fix for the new 9-teacher
-- figure is entirely in tierLimits.ts, not here. This migration does
-- NOT touch auth.users, profiles, handle_new_user(), or any
-- authentication path — it only replaces one pre-existing, pre-CA
-- SQL function definition used solely for the students-table
-- pre-insert check.
--
-- CREATE OR REPLACE, not a fresh CREATE — same function signature and
-- callers as migration 020, only the 'starter' branch's return value
-- changes. The existing trigger (enforce_student_tier_limit) already
-- calls this function by name, so it automatically picks up the new
-- limit without needing to be recreated itself.

CREATE OR REPLACE FUNCTION tier_student_limit(p_tier TEXT)
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_tier
    WHEN 'free' THEN 20
    WHEN 'starter' THEN 49
    WHEN 'professional' THEN 1500
    ELSE NULL -- enterprise, and any unrecognized value: unlimited
  END;
$$;

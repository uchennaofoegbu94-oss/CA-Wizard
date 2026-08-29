-- ============================================================
-- 020: subscription tier enforcement (students, grading systems)
-- ============================================================
-- Enforces exactly what's stated on the pricing page — nothing more:
--   Starter:      up to 100 Active Students, no custom grading scales
--   Professional: up to 1,500 Active Students, custom grading scales unlocked
--   Enterprise:   unlimited (its OTHER differentiators — SIS/API
--                 integrations, custom transcript templates, dedicated
--                 account manager/SLA, advanced compliance tooling —
--                 are explicitly NOT built here; this migration only
--                 removes Enterprise from the caps below, it does not
--                 implement any Enterprise-exclusive feature)
--
-- 'free' isn't a tier the pricing page defines at all — it's the
-- schema's original default, predating the current pricing structure.
-- Treated here as the most conservative tier (stricter than Starter),
-- on the assumption it's meant as an unconfigured/trial state rather
-- than a real product tier. Flagging this assumption explicitly since
-- nothing anywhere actually specifies what 'free' should mean.
--
-- Both caps below count only what the pricing page's own wording counts
-- — "Active Students" means status='active' specifically, not the full
-- historical roster (withdrawn/graduated/transferred students don't
-- count against the cap, and neither should they — a school with a long
-- history shouldn't be blocked from enrolling a new student because of
-- headcount from years ago).

CREATE OR REPLACE FUNCTION tier_student_limit(p_tier TEXT)
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_tier
    WHEN 'free' THEN 20
    WHEN 'starter' THEN 100
    WHEN 'professional' THEN 1500
    ELSE NULL -- enterprise, and any unrecognized value: unlimited
  END;
$$;

CREATE OR REPLACE FUNCTION tier_grading_system_limit(p_tier TEXT)
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_tier
    WHEN 'free' THEN 1
    WHEN 'starter' THEN 1
    ELSE NULL -- professional/enterprise: unlimited custom grading systems
  END;
$$;

CREATE OR REPLACE FUNCTION enforce_student_tier_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tier TEXT;
  v_limit INT;
  v_active_count INT;
BEGIN
  SELECT subscription_tier INTO v_tier FROM schools WHERE id = NEW.school_id;
  v_limit := tier_student_limit(v_tier);

  IF v_limit IS NOT NULL THEN
    SELECT COUNT(*) INTO v_active_count FROM students
    WHERE school_id = NEW.school_id AND status = 'active';

    -- NEW itself isn't counted yet (this fires BEFORE the insert), so
    -- the check is "would adding this one push us over," not "are we
    -- already over" — off-by-one here would either block the exact
    -- Nth student that should be allowed, or let in one too many.
    IF NEW.status = 'active' AND v_active_count >= v_limit THEN
      RAISE EXCEPTION 'Student limit reached for the % plan (% active students). Upgrade to add more.', v_tier, v_limit;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_student_tier_limit ON students;
CREATE TRIGGER trg_enforce_student_tier_limit
  BEFORE INSERT ON students
  FOR EACH ROW EXECUTE FUNCTION enforce_student_tier_limit();

CREATE OR REPLACE FUNCTION enforce_grading_system_tier_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tier TEXT;
  v_limit INT;
  v_count INT;
BEGIN
  SELECT subscription_tier INTO v_tier FROM schools WHERE id = NEW.school_id;
  v_limit := tier_grading_system_limit(v_tier);

  IF v_limit IS NOT NULL THEN
    SELECT COUNT(*) INTO v_count FROM grading_systems WHERE school_id = NEW.school_id;
    IF v_count >= v_limit THEN
      RAISE EXCEPTION 'Custom grading scales require the Professional plan or higher. Upgrade to create additional grading systems.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_grading_system_tier_limit ON grading_systems;
CREATE TRIGGER trg_enforce_grading_system_tier_limit
  BEFORE INSERT ON grading_systems
  FOR EACH ROW EXECUTE FUNCTION enforce_grading_system_tier_limit();

-- Teacher caps are deliberately NOT enforced here. New teacher profiles
-- are created via handle_new_user(), a trigger on auth.users that has
-- its own top-level exception handler which SWALLOWS any error from
-- the profiles insert (logs a WARNING, still returns success) — meaning
-- a BEFORE INSERT trigger on profiles raising an exception here would
-- silently fail to create the profile while the auth.users account
-- (the actual login) still gets created successfully. That's an
-- orphaned account, strictly worse than no enforcement at all. Teacher
-- limits are enforced client-side instead, at invite-code generation
-- and redemption — see TeachersPage.tsx and JoinPage.tsx.
--
-- JoinPage's redemption-time check runs BEFORE the person is
-- authenticated (they haven't called signUp yet), so it executes as
-- the anon role — and profiles RLS grants anon no access at all. A
-- direct count query from the client would silently always return 0,
-- making the check a no-op rather than actually broken-and-visible.
-- This function is the fix: SECURITY DEFINER, callable by anon, but it
-- only ever returns a count — never any row data — so there's nothing
-- sensitive exposed by making it public.
CREATE OR REPLACE FUNCTION count_active_teachers(p_school_id UUID)
RETURNS INT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COUNT(*)::INT FROM profiles
  WHERE school_id = p_school_id AND role = 'teacher' AND is_active = true;
$$;

GRANT EXECUTE ON FUNCTION count_active_teachers TO anon, authenticated;

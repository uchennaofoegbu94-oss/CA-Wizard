-- ============================================================
-- 014: auto-populate new sessions (terms + class roster)
-- ============================================================
-- Previously, every new session started completely empty — no terms,
-- no classes — meaning a school_admin had to manually recreate every
-- class_level x class_arm combination and all 3 terms by hand each
-- time a new session began, even though class_levels and class_arms
-- themselves are already school-wide (not session-scoped) and rarely
-- change year to year.
--
-- This is a database trigger rather than app code so it's guaranteed
-- to fire no matter which code path inserts a session (the app's
-- createSession mutation today, a future admin tool, a script — all
-- of it), consistent with how migration 013's delete-safety trigger
-- was built for the same reason.

CREATE OR REPLACE FUNCTION auto_populate_new_session()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prior_session_id UUID;
BEGIN
  -- 1. Every session gets the same 3 standard terms, none current/
  -- published/locked by default — a school_admin still explicitly
  -- sets the current term and publishes/locks each one when ready.
  INSERT INTO terms (school_id, session_id, name, is_current, is_published, is_locked)
  VALUES
    (NEW.school_id, NEW.id, 'First Term',  false, false, false),
    (NEW.school_id, NEW.id, 'Second Term', false, false, false),
    (NEW.school_id, NEW.id, 'Third Term',  false, false, false);

  -- 2. Copy the class roster structure (class_level x class_arm
  -- combinations, plus form_teacher_id as a starting default — still
  -- freely reassignable afterward) from the most recent PRIOR session
  -- for this school. If this is the school's very first session,
  -- there's nothing to copy from, which is expected, not an error.
  SELECT id INTO v_prior_session_id
  FROM sessions
  WHERE school_id = NEW.school_id AND id != NEW.id
  ORDER BY start_year DESC
  LIMIT 1;

  IF v_prior_session_id IS NOT NULL THEN
    INSERT INTO classes (school_id, session_id, class_level_id, class_arm_id, form_teacher_id)
    SELECT school_id, NEW.id, class_level_id, class_arm_id, form_teacher_id
    FROM classes
    WHERE session_id = v_prior_session_id
    ON CONFLICT (session_id, class_level_id, class_arm_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_populate_new_session ON sessions;
CREATE TRIGGER trg_auto_populate_new_session
  AFTER INSERT ON sessions
  FOR EACH ROW EXECUTE FUNCTION auto_populate_new_session();

-- ============================================================
-- 017: fix auto_populate_new_session's ON CONFLICT bug
-- ============================================================
-- Migration 014's trigger inserted new-session classes with
-- `ON CONFLICT (session_id, class_level_id, class_arm_id) DO NOTHING`.
-- That assumes a single plain unique constraint on those three
-- columns — but migration 004 (three migrations earlier, and predating
-- this feature entirely) had already replaced that constraint with two
-- PARTIAL unique indexes to handle class_arm_id being nullable
-- correctly:
--   idx_classes_unique_with_arm    (session_id, class_level_id, class_arm_id) WHERE class_arm_id IS NOT NULL
--   idx_classes_unique_without_arm (session_id, class_level_id)              WHERE class_arm_id IS NULL
-- ON CONFLICT must match a constraint/index's column list AND predicate
-- exactly — naming the same three columns doesn't match either partial
-- index, which is exactly what "no unique or exclusion constraint
-- matching the ON CONFLICT specification" means. Should have cross-
-- checked this trigger against migration 004 before shipping it.
--
-- Fix: use a plain NOT EXISTS guard instead of ON CONFLICT. This is
-- actually more robust than matching a specific index anyway — it
-- doesn't care how (or whether) uniqueness is enforced underneath it,
-- so it can't be broken by a future change to the classes table's
-- constraints the same way the ON CONFLICT version just was.

CREATE OR REPLACE FUNCTION auto_populate_new_session()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prior_session_id UUID;
BEGIN
  INSERT INTO terms (school_id, session_id, name, is_current, is_published, is_locked)
  VALUES
    (NEW.school_id, NEW.id, 'First Term',  false, false, false),
    (NEW.school_id, NEW.id, 'Second Term', false, false, false),
    (NEW.school_id, NEW.id, 'Third Term',  false, false, false);

  SELECT id INTO v_prior_session_id
  FROM sessions
  WHERE school_id = NEW.school_id AND id != NEW.id
  ORDER BY start_year DESC
  LIMIT 1;

  IF v_prior_session_id IS NOT NULL THEN
    INSERT INTO classes (school_id, session_id, class_level_id, class_arm_id, form_teacher_id)
    SELECT prior.school_id, NEW.id, prior.class_level_id, prior.class_arm_id, prior.form_teacher_id
    FROM classes prior
    WHERE prior.session_id = v_prior_session_id
      AND NOT EXISTS (
        SELECT 1 FROM classes existing
        WHERE existing.session_id = NEW.id
          AND existing.class_level_id = prior.class_level_id
          AND existing.class_arm_id IS NOT DISTINCT FROM prior.class_arm_id
      );
  END IF;

  RETURN NEW;
END;
$$;

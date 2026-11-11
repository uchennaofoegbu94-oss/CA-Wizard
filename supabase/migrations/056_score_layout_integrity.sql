-- 056_score_layout_integrity.sql
--
-- WHY: after 054, a class in a section that has its own assessment layout
-- must record scores against THAT layout's fields. An app build that predates
-- 054 (a Vercel deploy that hasn't been updated, a PWA tab that hasn't
-- reloaded, a phone's offline queue) doesn't know about layouts: it lists
-- every field in the school (so fields appear duplicated) and writes scores
-- against whichever column the teacher typed in — including the default
-- layout's field for a class that now uses a section layout. The database
-- accepted that write, and the new engine silently ignored it (the score
-- existed but was never counted).
--
-- WHAT THIS ADDS
--  1. guard_score_layout (trigger on student_scores): if a score's field is
--     in a different layout than its class uses, re-point it to the SAME-NAMED
--     field in the class's layout. A stale client can keep working without
--     losing data, and an upsert from one lands on the existing row instead
--     of creating a stray. If no same-named field exists the write is
--     refused with a clear message instead of being silently misfiled.
--  2. diagnose_layout_integrity(): read-only report (per school) of layouts,
--     stray scores, and how many could/couldn't be repaired.
--  3. repair_layout_scores(): moves existing stray scores onto the matching
--     field of the class's layout. Never overwrites a score that already
--     exists on the target (those are reported as conflicts) and is idempotent.
--
-- Both functions can be run from the Supabase SQL editor (as the postgres
-- role, all schools) or by a school admin / super admin for their own school.

-- ───────────────────────── 1. Guard trigger ─────────────────────────
CREATE OR REPLACE FUNCTION guard_score_layout()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actual   UUID;
  v_name     TEXT;
  v_expected UUID;
  v_target   UUID;
BEGIN
  SELECT layout_id, name INTO v_actual, v_name FROM assessment_categories WHERE id = NEW.assessment_category_id;
  v_expected := layout_for_class(NEW.class_id);

  -- nothing to compare (unknown field/class are caught by their own FKs) or already correct
  IF v_actual IS NULL OR v_expected IS NULL OR v_actual = v_expected THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_target
  FROM assessment_categories
  WHERE layout_id = v_expected AND field_type = 'input' AND lower(btrim(name)) = lower(btrim(v_name))
  ORDER BY is_active DESC
  LIMIT 1;

  IF v_target IS NULL THEN
    RAISE EXCEPTION 'The field "%" is not part of the assessment layout this class uses. Reload the app to get the current fields.', v_name;
  END IF;

  NEW.assessment_category_id := v_target;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_guard_score_layout
  BEFORE INSERT OR UPDATE OF assessment_category_id, class_id ON student_scores
  FOR EACH ROW EXECUTE FUNCTION guard_score_layout();

-- ───────────────────────── 2. Diagnose (read-only) ─────────────────────────
-- Allowed: someone working directly in the database (the Supabase SQL editor connects as
-- postgres, with NO app user in the request), a super admin, or a school admin for p_school_id.
-- The direct-database path requires BOTH a privileged login AND no signed-in app user
-- (auth.uid() IS NULL), so it can never be reached through the API, where every request
-- carries a user and connects as `authenticator`.
CREATE OR REPLACE FUNCTION layout_tools_allowed(p_school_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(
    (session_user IN ('postgres', 'supabase_admin') AND auth.uid() IS NULL)
    OR is_super_admin()
    OR (p_school_id IS NOT NULL AND current_school_id() = p_school_id AND current_user_role() = 'school_admin'),
    FALSE);
$$;
REVOKE EXECUTE ON FUNCTION layout_tools_allowed(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION diagnose_layout_integrity(p_school_id UUID DEFAULT NULL)
RETURNS TABLE(school_id UUID, school_name TEXT, layouts BIGINT, section_layouts BIGINT,
              stray_scores BIGINT, repairable BIGINT, conflicts BIGINT, unmappable BIGINT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT layout_tools_allowed(p_school_id) THEN
    RAISE EXCEPTION 'diagnose_layout_integrity: not authorized (school admins must pass their own school id)';
  END IF;
  RETURN QUERY
  WITH stray AS (
    SELECT ss.id, ss.school_id AS sid, ss.student_id, ss.subject_id, ss.term_id,
           lower(btrim(ac.name)) AS nm, layout_for_class(ss.class_id) AS exp_layout
    FROM student_scores ss JOIN assessment_categories ac ON ac.id = ss.assessment_category_id
    WHERE (p_school_id IS NULL OR ss.school_id = p_school_id)
      AND layout_for_class(ss.class_id) IS NOT NULL
      AND ac.layout_id <> layout_for_class(ss.class_id)
  ), mapped AS (
    SELECT s.*, t.id AS target_id
    FROM stray s
    LEFT JOIN LATERAL (
      SELECT c.id FROM assessment_categories c
      WHERE c.layout_id = s.exp_layout AND c.field_type = 'input' AND lower(btrim(c.name)) = s.nm
      ORDER BY c.is_active DESC LIMIT 1
    ) t ON TRUE
  ), classified AS (
    SELECT m.sid,
      (m.target_id IS NULL) AS no_target,
      (m.target_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM student_scores x WHERE x.student_id = m.student_id AND x.subject_id = m.subject_id
          AND x.term_id = m.term_id AND x.assessment_category_id = m.target_id)) AS has_conflict
    FROM mapped m
  )
  SELECT s.id, s.name,
    (SELECT count(*) FROM assessment_layouts l WHERE l.school_id = s.id),
    (SELECT count(*) FROM assessment_layouts l WHERE l.school_id = s.id AND l.section_id IS NOT NULL),
    (SELECT count(*) FROM classified c WHERE c.sid = s.id),
    (SELECT count(*) FROM classified c WHERE c.sid = s.id AND NOT c.no_target AND NOT c.has_conflict),
    (SELECT count(*) FROM classified c WHERE c.sid = s.id AND c.has_conflict),
    (SELECT count(*) FROM classified c WHERE c.sid = s.id AND c.no_target)
  FROM schools s
  WHERE p_school_id IS NULL OR s.id = p_school_id
  ORDER BY s.name;
END $$;

-- ───────────────────────── 3. Repair ─────────────────────────
CREATE OR REPLACE FUNCTION repair_layout_scores(p_school_id UUID DEFAULT NULL)
RETURNS TABLE(moved BIGINT, conflicts BIGINT, unmappable BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_moved BIGINT := 0; v_conf BIGINT := 0; v_unmap BIGINT := 0;
BEGIN
  IF NOT layout_tools_allowed(p_school_id) THEN
    RAISE EXCEPTION 'repair_layout_scores: not authorized (school admins must pass their own school id)';
  END IF;

  -- The guard would re-point rows on UPDATE too; here we do it explicitly so we can count and skip conflicts.
  WITH stray AS (
    SELECT ss.id, ss.student_id, ss.subject_id, ss.term_id, lower(btrim(ac.name)) AS nm, layout_for_class(ss.class_id) AS exp_layout
    FROM student_scores ss JOIN assessment_categories ac ON ac.id = ss.assessment_category_id
    WHERE (p_school_id IS NULL OR ss.school_id = p_school_id)
      AND layout_for_class(ss.class_id) IS NOT NULL
      AND ac.layout_id <> layout_for_class(ss.class_id)
  ), mapped AS (
    SELECT s.*, t.id AS target_id
    FROM stray s
    LEFT JOIN LATERAL (
      SELECT c.id FROM assessment_categories c
      WHERE c.layout_id = s.exp_layout AND c.field_type = 'input' AND lower(btrim(c.name)) = s.nm
      ORDER BY c.is_active DESC LIMIT 1
    ) t ON TRUE
  ), safe AS (
    SELECT m.id, m.target_id FROM mapped m
    WHERE m.target_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM student_scores x WHERE x.student_id = m.student_id AND x.subject_id = m.subject_id
                      AND x.term_id = m.term_id AND x.assessment_category_id = m.target_id)
  ), upd AS (
    UPDATE student_scores ss SET assessment_category_id = safe.target_id
    FROM safe WHERE ss.id = safe.id
    RETURNING ss.id
  )
  SELECT count(*) INTO v_moved FROM upd;

  -- what is left stray after the move, split into the two reasons it couldn't be moved
  SELECT
    count(*) FILTER (WHERE tgt IS NOT NULL),
    count(*) FILTER (WHERE tgt IS NULL)
  INTO v_conf, v_unmap
  FROM (
    SELECT (SELECT c.id FROM assessment_categories c
            WHERE c.layout_id = layout_for_class(ss.class_id) AND c.field_type = 'input'
              AND lower(btrim(c.name)) = lower(btrim(ac.name))
            ORDER BY c.is_active DESC LIMIT 1) AS tgt
    FROM student_scores ss JOIN assessment_categories ac ON ac.id = ss.assessment_category_id
    WHERE (p_school_id IS NULL OR ss.school_id = p_school_id)
      AND layout_for_class(ss.class_id) IS NOT NULL
      AND ac.layout_id <> layout_for_class(ss.class_id)
  ) left_over;

  RETURN QUERY SELECT v_moved, v_conf, v_unmap;
END $$;

REVOKE EXECUTE ON FUNCTION diagnose_layout_integrity(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION repair_layout_scores(UUID)      FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION diagnose_layout_integrity(UUID) TO authenticated;
GRANT  EXECUTE ON FUNCTION repair_layout_scores(UUID)      TO authenticated;

-- ============================================================
-- 048: Read-only computed-field preview on Score Entry
-- ============================================================
-- Computed fields (Test Average, C.A. totals, Total, etc.) are
-- deliberately never enterable on Score Entry — teachers don't type
-- a value for something the system calculates. That's unchanged here.
--
-- What this adds: an admin-controlled, per-field, PURELY DISPLAY
-- opt-in that lets a computed field's live value also show up as a
-- read-only column on Score Entry, so a teacher can sanity-check
-- their raw input as they go (catching an obvious entry mistake
-- immediately, rather than only discovering it later on the
-- school-admin broadsheet). Nothing about this touches how any field
-- computes or how a value gets written — score_field_sources,
-- resolve_score_fields, and every enforcement trigger are completely
-- untouched by this migration. This is a display flag only.
--
-- Scoped to computed fields on purpose (see the CHECK constraint) —
-- an input field is already directly editable on that same page, so
-- a read-only preview of it would be redundant.
-- ============================================================

ALTER TABLE assessment_categories
  ADD COLUMN show_on_score_entry BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE assessment_categories
  ADD CONSTRAINT chk_score_entry_preview_is_computed CHECK (
    NOT show_on_score_entry OR field_type = 'computed'
  );

-- ---- Thread show_on_score_entry through the compute engine ----
-- resolve_score_fields and its three per-scope wrappers all need this
-- new column added to their RETURNS TABLE so the frontend can filter
-- on it — a RETURNS TABLE column list is a fixed part of a function's
-- signature in Postgres, so this requires DROP + CREATE rather than
-- CREATE OR REPLACE (which only accepts changes that keep the exact
-- same signature). The actual computation logic inside each function
-- body is copied verbatim from migration 043, completely unchanged —
-- only the RETURNS TABLE column list and the final SELECT's column
-- list gained one entry. get_school_term_totals is untouched: it
-- already returns a deliberately lean, different shape (no per-field
-- breakdown at all) that this feature doesn't need.

DROP FUNCTION IF EXISTS get_class_all_fields(UUID, UUID);
DROP FUNCTION IF EXISTS get_class_subject_term_results(UUID, UUID, UUID);
DROP FUNCTION IF EXISTS get_score_fields(UUID, UUID, UUID);
DROP FUNCTION IF EXISTS resolve_score_fields(UUID, UUID, UUID, UUID);

CREATE FUNCTION resolve_score_fields(
  p_school_id UUID,
  p_student_id UUID,
  p_subject_id UUID,
  p_term_id UUID
)
RETURNS TABLE (
  field_id              UUID,
  field_name            TEXT,
  field_type            score_field_type,
  compute_operation     score_compute_operation,
  order_index           INT,
  show_on_report_card   BOOLEAN,
  show_on_score_entry   BOOLEAN,
  is_total_field        BOOLEAN,
  value                 NUMERIC,
  max_value             NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_resolved   JSONB := '{}'::jsonb;
  v_progress   BOOLEAN;
  v_field      RECORD;
  v_src        RECORD;
  v_val        NUMERIC;
  v_max        NUMERIC;
  v_all_ready  BOOLEAN;
  v_sum_val    NUMERIC;
  v_sum_max    NUMERIC;
  v_sum_weight NUMERIC;
  v_sum_pct    NUMERIC;
BEGIN
  -- Pass 0: every active input field resolves directly from student_scores.
  FOR v_field IN
    SELECT ac.id, ac.max_score
    FROM assessment_categories ac
    WHERE ac.school_id = p_school_id AND ac.field_type = 'input' AND ac.is_active = TRUE
  LOOP
    SELECT COALESCE(ss.score, 0) INTO v_val
    FROM student_scores ss
    WHERE ss.assessment_category_id = v_field.id
      AND ss.student_id = p_student_id
      AND ss.subject_id = p_subject_id
      AND ss.term_id = p_term_id;
    v_resolved := v_resolved || jsonb_build_object(
      v_field.id::text, jsonb_build_object('value', COALESCE(v_val, 0), 'max_value', v_field.max_score)
    );
  END LOOP;

  -- Fixed-point loop over computed fields, any dependency depth.
  LOOP
    v_progress := FALSE;

    FOR v_field IN
      SELECT ac.id, ac.compute_operation
      FROM assessment_categories ac
      WHERE ac.school_id = p_school_id AND ac.field_type = 'computed' AND ac.is_active = TRUE
        AND NOT (v_resolved ? ac.id::text)
    LOOP
      v_all_ready := TRUE;
      v_sum_val := 0; v_sum_max := 0; v_sum_weight := 0; v_sum_pct := 0;

      FOR v_src IN SELECT sfs.source_field_id, sfs.weight FROM score_field_sources sfs WHERE sfs.field_id = v_field.id LOOP
        IF NOT (v_resolved ? v_src.source_field_id::text) THEN
          v_all_ready := FALSE;
          EXIT;
        END IF;
        v_val := (v_resolved -> v_src.source_field_id::text ->> 'value')::numeric;
        v_max := (v_resolved -> v_src.source_field_id::text ->> 'max_value')::numeric;
        v_sum_val := v_sum_val + v_val * v_src.weight;
        v_sum_max := v_sum_max + v_max * v_src.weight;
        v_sum_weight := v_sum_weight + v_src.weight;
        IF v_max > 0 THEN
          v_sum_pct := v_sum_pct + (v_val / v_max) * v_src.weight;
        END IF;
      END LOOP;

      IF v_all_ready THEN
        CASE v_field.compute_operation
          WHEN 'sum' THEN
            v_resolved := v_resolved || jsonb_build_object(
              v_field.id::text, jsonb_build_object('value', ROUND(v_sum_val, 2), 'max_value', ROUND(v_sum_max, 2))
            );
          WHEN 'average' THEN
            v_resolved := v_resolved || jsonb_build_object(
              v_field.id::text, jsonb_build_object(
                'value', ROUND(v_sum_val / NULLIF(v_sum_weight, 0), 2),
                'max_value', ROUND(v_sum_max / NULLIF(v_sum_weight, 0), 2)
              )
            );
          WHEN 'weighted_percentage' THEN
            v_resolved := v_resolved || jsonb_build_object(
              v_field.id::text, jsonb_build_object('value', ROUND(v_sum_pct, 2), 'max_value', ROUND(v_sum_weight, 2))
            );
        END CASE;
        v_progress := TRUE;
      END IF;
    END LOOP;

    EXIT WHEN NOT v_progress;
  END LOOP;

  RETURN QUERY
  SELECT
    ac.id, ac.name, ac.field_type, ac.compute_operation, ac.order_index,
    ac.show_on_report_card, ac.show_on_score_entry, ac.is_total_field,
    (v_resolved -> ac.id::text ->> 'value')::numeric,
    (v_resolved -> ac.id::text ->> 'max_value')::numeric
  FROM assessment_categories ac
  WHERE ac.school_id = p_school_id AND ac.is_active = TRUE AND (v_resolved ? ac.id::text)
  ORDER BY ac.order_index;
END;
$$;

CREATE FUNCTION get_score_fields(
  p_student_id UUID,
  p_subject_id UUID,
  p_term_id UUID
)
RETURNS TABLE (
  field_id              UUID,
  field_name            TEXT,
  field_type            score_field_type,
  compute_operation     score_compute_operation,
  order_index           INT,
  show_on_report_card   BOOLEAN,
  show_on_score_entry   BOOLEAN,
  is_total_field        BOOLEAN,
  value                 NUMERIC,
  max_value             NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school_id UUID;
BEGIN
  SELECT school_id INTO v_school_id FROM students WHERE id = p_student_id;

  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'get_score_fields: student not found';
  END IF;

  IF NOT COALESCE((
    is_super_admin()
    OR (current_school_id() = v_school_id AND current_user_role() = 'school_admin')
  ), FALSE) THEN
    RAISE EXCEPTION 'get_score_fields: not authorized for this student''s school';
  END IF;

  RETURN QUERY
  SELECT * FROM resolve_score_fields(v_school_id, p_student_id, p_subject_id, p_term_id);
END;
$$;

CREATE FUNCTION get_class_subject_term_results(
  p_class_id UUID,
  p_subject_id UUID,
  p_term_id UUID
)
RETURNS TABLE (
  student_id             UUID,
  field_id               UUID,
  field_name             TEXT,
  field_type             score_field_type,
  compute_operation      score_compute_operation,
  order_index            INT,
  show_on_report_card    BOOLEAN,
  show_on_score_entry    BOOLEAN,
  is_total_field         BOOLEAN,
  value                  NUMERIC,
  max_value              NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school_id UUID;
BEGIN
  SELECT school_id INTO v_school_id FROM classes WHERE id = p_class_id;

  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'get_class_subject_term_results: class not found';
  END IF;

  IF NOT COALESCE((
    is_super_admin()
    OR (current_school_id() = v_school_id AND current_user_role() = 'school_admin')
    OR (current_school_id() = v_school_id AND current_user_role() = 'teacher' AND teacher_has_class_access(p_class_id))
  ), FALSE) THEN
    RAISE EXCEPTION 'get_class_subject_term_results: not authorized for this class';
  END IF;

  RETURN QUERY
  SELECT r.student_id, rf.*
  FROM (SELECT DISTINCT student_enrollments.student_id FROM student_enrollments WHERE class_id = p_class_id) r
  CROSS JOIN LATERAL resolve_score_fields(v_school_id, r.student_id, p_subject_id, p_term_id) rf
  ORDER BY r.student_id, rf.order_index;
END;
$$;

CREATE FUNCTION get_class_all_fields(
  p_class_id UUID,
  p_term_id UUID
)
RETURNS TABLE (
  student_id             UUID,
  subject_id             UUID,
  field_id               UUID,
  field_name             TEXT,
  field_type             score_field_type,
  compute_operation      score_compute_operation,
  order_index            INT,
  show_on_report_card    BOOLEAN,
  show_on_score_entry    BOOLEAN,
  is_total_field         BOOLEAN,
  value                  NUMERIC,
  max_value              NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school_id UUID;
BEGIN
  SELECT school_id INTO v_school_id FROM classes WHERE id = p_class_id;

  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'get_class_all_fields: class not found';
  END IF;

  IF NOT COALESCE((
    is_super_admin()
    OR (current_school_id() = v_school_id AND current_user_role() = 'school_admin')
    OR (current_school_id() = v_school_id AND current_user_role() = 'teacher' AND teacher_has_class_access(p_class_id))
  ), FALSE) THEN
    RAISE EXCEPTION 'get_class_all_fields: not authorized for this class';
  END IF;

  RETURN QUERY
  SELECT r.student_id, cs.subject_id, rf.*
  FROM (SELECT DISTINCT student_enrollments.student_id FROM student_enrollments WHERE class_id = p_class_id) r
  CROSS JOIN (
    SELECT DISTINCT student_scores.subject_id FROM student_scores WHERE class_id = p_class_id AND term_id = p_term_id
    UNION
    SELECT DISTINCT teacher_assignments.subject_id FROM teacher_assignments WHERE class_id = p_class_id AND teacher_assignments.subject_id IS NOT NULL
  ) cs
  CROSS JOIN LATERAL resolve_score_fields(v_school_id, r.student_id, cs.subject_id, p_term_id) rf
  ORDER BY r.student_id, cs.subject_id, rf.order_index;
END;
$$;

GRANT EXECUTE ON FUNCTION resolve_score_fields(UUID, UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_score_fields(UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_class_subject_term_results(UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_class_all_fields(UUID, UUID) TO authenticated;

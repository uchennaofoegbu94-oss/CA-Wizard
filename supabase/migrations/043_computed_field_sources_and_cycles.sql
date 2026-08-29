-- ============================================================
-- CA-WIZARD | Migration 043 — Computed Fields as Sources
-- ============================================================
-- Widens the compute engine from a strict two-pass design (inputs
-- resolve, then computed fields resolve once, from inputs only) to
-- support a computed field sourcing from ANOTHER computed field, at
-- any depth (e.g. a "Grand Total" computed field that sums two other
-- computed fields, each of which is itself a weighted_percentage of
-- several inputs).
--
-- Two things had to change together for this to be safe:
--   1. A cycle-prevention check on score_field_sources — without it,
--      a field could depend on itself transitively (A sources B,
--      B sources A) and evaluation would never terminate.
--   2. The compute engine moves from "two fixed passes" to a
--      fixed-point resolution loop: repeatedly resolve whichever
--      computed fields have all their sources already resolved,
--      until nothing new resolves. This handles any dependency
--      depth without needing to know it in advance.
-- ============================================================

-- ---- Cycle prevention ----
-- Extends the existing same-school guard trigger (same function name,
-- same trigger already attached from migration 041 — CREATE OR
-- REPLACE updates the body in place, no need to touch the trigger
-- itself) with a check that adding this field_id -> source_field_id
-- edge wouldn't close a cycle in the dependency graph.

CREATE OR REPLACE FUNCTION check_score_field_source_same_school()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_field_school   UUID;
  v_source_school  UUID;
  v_cycle          BOOLEAN;
BEGIN
  SELECT school_id INTO v_field_school FROM public.assessment_categories WHERE id = NEW.field_id;
  SELECT school_id INTO v_source_school FROM public.assessment_categories WHERE id = NEW.source_field_id;

  IF v_field_school IS NULL OR v_source_school IS NULL THEN
    RAISE EXCEPTION 'score_field_sources: field_id or source_field_id does not exist';
  END IF;

  IF v_field_school != v_source_school OR v_field_school != NEW.school_id THEN
    RAISE EXCEPTION 'score_field_sources: field, source, and row school_id must all match';
  END IF;

  -- Walk source_field_id's OWN dependency chain (its sources,
  -- recursively). If field_id shows up in that chain, source_field_id
  -- already transitively depends on field_id — so adding
  -- field_id -> source_field_id here would close a cycle.
  WITH RECURSIVE reachable AS (
    SELECT source_field_id AS node FROM public.score_field_sources WHERE field_id = NEW.source_field_id
    UNION
    SELECT sfs.source_field_id
    FROM public.score_field_sources sfs
    JOIN reachable r ON sfs.field_id = r.node
  )
  SELECT EXISTS (SELECT 1 FROM reachable WHERE node = NEW.field_id) INTO v_cycle;

  IF v_cycle THEN
    RAISE EXCEPTION 'score_field_sources: this would create a circular dependency between computed fields';
  END IF;

  RETURN NEW;
END;
$$;

-- ---- Core resolver ----
-- Resolves every active field's (value, max_value) for one
-- student/subject/term, via fixed-point iteration: input fields
-- resolve immediately; a computed field resolves as soon as every one
-- of its sources (input OR computed) is already resolved; repeat
-- until no pass makes progress. A field that never becomes resolvable
-- (only possible via a cycle, which the trigger above prevents at
-- write-time, or a source that's been deactivated) simply doesn't
-- appear in the output, rather than blocking every other field.
CREATE OR REPLACE FUNCTION resolve_score_fields(
  p_school_id UUID,
  p_student_id UUID,
  p_subject_id UUID,
  p_term_id UUID
)
RETURNS TABLE (
  field_id             UUID,
  field_name           TEXT,
  field_type           score_field_type,
  compute_operation    score_compute_operation,
  order_index          INT,
  show_on_report_card  BOOLEAN,
  is_total_field       BOOLEAN,
  value                NUMERIC,
  max_value            NUMERIC
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
    ac.show_on_report_card, ac.is_total_field,
    (v_resolved -> ac.id::text ->> 'value')::numeric,
    (v_resolved -> ac.id::text ->> 'max_value')::numeric
  FROM assessment_categories ac
  WHERE ac.school_id = p_school_id AND ac.is_active = TRUE AND (v_resolved ? ac.id::text)
  ORDER BY ac.order_index;
END;
$$;

-- ---- Public RPCs, rewritten to call the shared resolver ----
-- Authorization checks are unchanged from migration 042 — only the
-- computation itself moved into resolve_score_fields above.

CREATE OR REPLACE FUNCTION get_score_fields(
  p_student_id UUID,
  p_subject_id UUID,
  p_term_id UUID
)
RETURNS TABLE (
  field_id             UUID,
  field_name           TEXT,
  field_type           score_field_type,
  compute_operation    score_compute_operation,
  order_index          INT,
  show_on_report_card  BOOLEAN,
  is_total_field       BOOLEAN,
  value                NUMERIC,
  max_value            NUMERIC
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

CREATE OR REPLACE FUNCTION get_class_subject_term_results(
  p_class_id UUID,
  p_subject_id UUID,
  p_term_id UUID
)
RETURNS TABLE (
  student_id           UUID,
  field_id             UUID,
  field_name           TEXT,
  field_type           score_field_type,
  compute_operation    score_compute_operation,
  order_index          INT,
  show_on_report_card  BOOLEAN,
  is_total_field       BOOLEAN,
  value                NUMERIC,
  max_value            NUMERIC
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

CREATE OR REPLACE FUNCTION get_class_all_fields(
  p_class_id UUID,
  p_term_id UUID
)
RETURNS TABLE (
  student_id           UUID,
  subject_id           UUID,
  field_id             UUID,
  field_name           TEXT,
  field_type           score_field_type,
  compute_operation    score_compute_operation,
  order_index          INT,
  show_on_report_card  BOOLEAN,
  is_total_field       BOOLEAN,
  value                NUMERIC,
  max_value            NUMERIC
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

CREATE OR REPLACE FUNCTION get_school_term_totals(
  p_school_id UUID,
  p_term_id UUID
)
RETURNS TABLE (
  student_id  UUID,
  class_id    UUID,
  subject_id  UUID,
  percentage  NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT COALESCE((
    is_super_admin()
    OR (current_school_id() = p_school_id AND current_user_role() = 'school_admin')
  ), FALSE) THEN
    RAISE EXCEPTION 'get_school_term_totals: not authorized for this school';
  END IF;

  RETURN QUERY
  SELECT
    p.student_id, p.class_id, p.subject_id,
    ROUND((rf.value / NULLIF(rf.max_value, 0)) * 100, 2)
  FROM (
    SELECT DISTINCT ss.student_id, ss.class_id, ss.subject_id
    FROM student_scores ss
    WHERE ss.school_id = p_school_id AND ss.term_id = p_term_id
  ) p
  CROSS JOIN LATERAL resolve_score_fields(p_school_id, p.student_id, p.subject_id, p_term_id) rf
  WHERE rf.is_total_field;
END;
$$;

GRANT EXECUTE ON FUNCTION resolve_score_fields(UUID, UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_score_fields(UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_class_subject_term_results(UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_class_all_fields(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_school_term_totals(UUID, UUID) TO authenticated;

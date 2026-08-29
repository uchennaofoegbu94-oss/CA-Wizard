-- ============================================================
-- CA-WIZARD | Migration 042 — Data Migration + Compute Engine
-- ============================================================
-- Part A: per-school data migration
--   1. Create an "Exam" input field per school, preserving that
--      school's actual historical exam max_score (modal value —
--      the max_score that appears most often among that school's
--      exam_scores rows; defaults to 60 if the school has none).
--   2. Migrate every exam_scores row into student_scores against
--      that new field.
--   3. Create a default "Total" computed field per school:
--      weighted_percentage, sourced from every existing CA input
--      category (proportionally weighted to sum to 40) + the new
--      Exam field (weighted 60) — this exactly reproduces the old
--      hardcoded 40:60 v_term_results formula as a configurable
--      instance, so no school's grade changes on cutover.
--
-- Part B: the compute engine — four SECURITY DEFINER functions
-- that resolve input fields, then evaluate computed fields via
-- score_field_sources (two-pass: inputs first, then computed).
-- ============================================================

-- ============================================================
-- PART A — DATA MIGRATION
-- ============================================================

DO $$
DECLARE
  v_school            RECORD;
  v_exam_max          NUMERIC(5,2);
  v_exam_field_id      UUID;
  v_total_field_id     UUID;
  v_next_order         INT;
  v_ca_max_sum         NUMERIC(10,2);
  v_cat                RECORD;
BEGIN
  FOR v_school IN SELECT id FROM schools LOOP

    -- ---- 1. Modal exam max_score for this school (default 60) ----
    SELECT max_score INTO v_exam_max
    FROM exam_scores
    WHERE school_id = v_school.id
    GROUP BY max_score
    ORDER BY COUNT(*) DESC, max_score DESC
    LIMIT 1;

    IF v_exam_max IS NULL THEN
      v_exam_max := 60;
    END IF;

    -- ---- 2. Create "Exam" input field (skip if a category with that
    --        name already exists for this school — defensive, not
    --        expected in practice since "Exam" was never a category) ----
    SELECT id INTO v_exam_field_id
    FROM assessment_categories
    WHERE school_id = v_school.id AND name = 'Exam';

    IF v_exam_field_id IS NULL THEN
      SELECT COALESCE(MAX(order_index), 0) + 1 INTO v_next_order
      FROM assessment_categories WHERE school_id = v_school.id;

      INSERT INTO assessment_categories
        (school_id, name, max_score, order_index, is_active, field_type, show_on_report_card)
      VALUES
        (v_school.id, 'Exam', v_exam_max, v_next_order, TRUE, 'input', TRUE)
      RETURNING id INTO v_exam_field_id;
    END IF;

    -- ---- 3. Migrate exam_scores rows into student_scores against
    --        the new field. ON CONFLICT DO NOTHING: safe to re-run,
    --        and a freshly-created field can't already have rows
    --        except on a second run of this migration. ----
    INSERT INTO student_scores
      (school_id, student_id, class_id, subject_id, term_id, assessment_category_id,
       score, entered_by, is_synced, created_at, updated_at)
    SELECT
      es.school_id, es.student_id, es.class_id, es.subject_id, es.term_id, v_exam_field_id,
      es.score, es.entered_by, es.is_synced, es.created_at, es.updated_at
    FROM exam_scores es
    WHERE es.school_id = v_school.id
    ON CONFLICT (student_id, subject_id, term_id, assessment_category_id) DO NOTHING;

    -- ---- 4. Create default "Total" computed field ----
    SELECT id INTO v_total_field_id
    FROM assessment_categories
    WHERE school_id = v_school.id AND is_total_field = TRUE;

    IF v_total_field_id IS NULL THEN
      SELECT COALESCE(MAX(order_index), 0) + 1 INTO v_next_order
      FROM assessment_categories WHERE school_id = v_school.id;

      INSERT INTO assessment_categories
        (school_id, name, max_score, order_index, is_active, field_type, compute_operation,
         show_on_report_card, is_total_field)
      VALUES
        (v_school.id, 'Total', 100, v_next_order, TRUE, 'computed', 'weighted_percentage',
         TRUE, TRUE)
      RETURNING id INTO v_total_field_id;

      -- ---- 5. Source weights: existing CA input categories
      --        (everything input except the new Exam field) get a
      --        combined weight of 40, split proportionally to each
      --        category's own max_score share of the CA max total.
      --        Exam gets a flat weight of 60. This is the algebraic
      --        identity that reproduces (ca_total/ca_max)*40 exactly:
      --        weight_i = 40 * (max_i / sum(max_ca)). ----
      SELECT COALESCE(SUM(max_score), 0) INTO v_ca_max_sum
      FROM assessment_categories
      WHERE school_id = v_school.id
        AND field_type = 'input'
        AND id != v_exam_field_id
        AND is_active = TRUE;

      IF v_ca_max_sum > 0 THEN
        FOR v_cat IN
          SELECT id, max_score FROM assessment_categories
          WHERE school_id = v_school.id
            AND field_type = 'input'
            AND id != v_exam_field_id
            AND is_active = TRUE
        LOOP
          INSERT INTO score_field_sources (school_id, field_id, source_field_id, weight)
          VALUES (v_school.id, v_total_field_id, v_cat.id, ROUND(40 * (v_cat.max_score / v_ca_max_sum), 4));
        END LOOP;
      END IF;

      INSERT INTO score_field_sources (school_id, field_id, source_field_id, weight)
      VALUES (v_school.id, v_total_field_id, v_exam_field_id, 60);
    END IF;

  END LOOP;
END $$;

-- ============================================================
-- PART B — COMPUTE ENGINE
-- ============================================================

-- ---- get_score_fields: every field's value for one student, one
-- subject, one term. Powers ReportCardPage (single report card). ----

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

  -- Authorization: this backs ReportCardPage (school-admin only). A
  -- SECURITY DEFINER function bypasses RLS entirely, so this check is
  -- the only thing standing between one school's caller and another
  -- school's report-card data — it is not optional defence-in-depth.
  IF NOT COALESCE((
    is_super_admin()
    OR (current_school_id() = v_school_id AND current_user_role() = 'school_admin')
  ), FALSE) THEN
    RAISE EXCEPTION 'get_score_fields: not authorized for this student''s school';
  END IF;

  RETURN QUERY
  WITH input_values AS (
    SELECT
      ac.id AS f_id, ac.name AS f_name, ac.field_type AS f_type, ac.compute_operation AS f_op,
      ac.order_index AS f_order, ac.show_on_report_card AS f_show, ac.is_total_field AS f_total,
      COALESCE(ss.score, 0) AS f_value, ac.max_score AS f_max
    FROM assessment_categories ac
    LEFT JOIN student_scores ss
      ON ss.assessment_category_id = ac.id
      AND ss.student_id = p_student_id
      AND ss.subject_id = p_subject_id
      AND ss.term_id = p_term_id
    WHERE ac.school_id = v_school_id
      AND ac.field_type = 'input'
      AND ac.is_active = TRUE
  ),
  computed_values AS (
    SELECT
      ac.id AS f_id, ac.name AS f_name, ac.field_type AS f_type, ac.compute_operation AS f_op,
      ac.order_index AS f_order, ac.show_on_report_card AS f_show, ac.is_total_field AS f_total,
      CASE ac.compute_operation
        WHEN 'sum' THEN SUM(iv.f_value * sfs.weight)
        WHEN 'average' THEN SUM(iv.f_value * sfs.weight) / NULLIF(SUM(sfs.weight), 0)
        WHEN 'weighted_percentage' THEN SUM((iv.f_value / NULLIF(iv.f_max, 0)) * sfs.weight)
      END AS f_value,
      CASE ac.compute_operation
        WHEN 'sum' THEN SUM(iv.f_max * sfs.weight)
        WHEN 'average' THEN SUM(iv.f_max * sfs.weight) / NULLIF(SUM(sfs.weight), 0)
        WHEN 'weighted_percentage' THEN SUM(sfs.weight)
      END AS f_max
    FROM assessment_categories ac
    JOIN score_field_sources sfs ON sfs.field_id = ac.id
    JOIN input_values iv ON iv.f_id = sfs.source_field_id
    WHERE ac.school_id = v_school_id
      AND ac.field_type = 'computed'
      AND ac.is_active = TRUE
    GROUP BY ac.id, ac.name, ac.field_type, ac.compute_operation, ac.order_index,
             ac.show_on_report_card, ac.is_total_field
  )
  SELECT f_id, f_name, f_type, f_op, f_order, f_show, f_total, ROUND(f_value, 2), ROUND(f_max, 2)
  FROM input_values
  UNION ALL
  SELECT f_id, f_name, f_type, f_op, f_order, f_show, f_total, ROUND(f_value, 2), ROUND(f_max, 2)
  FROM computed_values
  ORDER BY 5;
END;
$$;

-- ---- get_class_subject_term_results: every field, every student
-- in a class, for one subject/term. Powers BroadsheetPage, and
-- ranking (position calc) on ReportCardPage. ----

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

  -- Authorization: this backs both BroadsheetPage (teacher, own
  -- assigned classes only) and ReportCardPage's ranking calc
  -- (school_admin). SECURITY DEFINER bypasses RLS, so this is load-
  -- bearing, not defence-in-depth.
  IF NOT COALESCE((
    is_super_admin()
    OR (current_school_id() = v_school_id AND current_user_role() = 'school_admin')
    OR (current_school_id() = v_school_id AND current_user_role() = 'teacher' AND teacher_has_class_access(p_class_id))
  ), FALSE) THEN
    RAISE EXCEPTION 'get_class_subject_term_results: not authorized for this class';
  END IF;

  RETURN QUERY
  WITH roster AS (
    SELECT DISTINCT student_enrollments.student_id FROM student_enrollments WHERE class_id = p_class_id
  ),
  input_values AS (
    SELECT
      r.student_id AS r_student,
      ac.id AS f_id, ac.name AS f_name, ac.field_type AS f_type, ac.compute_operation AS f_op,
      ac.order_index AS f_order, ac.show_on_report_card AS f_show, ac.is_total_field AS f_total,
      COALESCE(ss.score, 0) AS f_value, ac.max_score AS f_max
    FROM roster r
    CROSS JOIN assessment_categories ac
    LEFT JOIN student_scores ss
      ON ss.assessment_category_id = ac.id
      AND ss.student_id = r.student_id
      AND ss.subject_id = p_subject_id
      AND ss.term_id = p_term_id
    WHERE ac.school_id = v_school_id
      AND ac.field_type = 'input'
      AND ac.is_active = TRUE
  ),
  computed_values AS (
    SELECT
      iv.r_student,
      ac.id AS f_id, ac.name AS f_name, ac.field_type AS f_type, ac.compute_operation AS f_op,
      ac.order_index AS f_order, ac.show_on_report_card AS f_show, ac.is_total_field AS f_total,
      CASE ac.compute_operation
        WHEN 'sum' THEN SUM(iv.f_value * sfs.weight)
        WHEN 'average' THEN SUM(iv.f_value * sfs.weight) / NULLIF(SUM(sfs.weight), 0)
        WHEN 'weighted_percentage' THEN SUM((iv.f_value / NULLIF(iv.f_max, 0)) * sfs.weight)
      END AS f_value,
      CASE ac.compute_operation
        WHEN 'sum' THEN SUM(iv.f_max * sfs.weight)
        WHEN 'average' THEN SUM(iv.f_max * sfs.weight) / NULLIF(SUM(sfs.weight), 0)
        WHEN 'weighted_percentage' THEN SUM(sfs.weight)
      END AS f_max
    FROM assessment_categories ac
    JOIN score_field_sources sfs ON sfs.field_id = ac.id
    JOIN input_values iv ON iv.f_id = sfs.source_field_id
    WHERE ac.school_id = v_school_id
      AND ac.field_type = 'computed'
      AND ac.is_active = TRUE
    GROUP BY iv.r_student, ac.id, ac.name, ac.field_type, ac.compute_operation,
             ac.order_index, ac.show_on_report_card, ac.is_total_field
  )
  SELECT r_student, f_id, f_name, f_type, f_op, f_order, f_show, f_total, ROUND(f_value, 2), ROUND(f_max, 2)
  FROM input_values
  UNION ALL
  SELECT r_student, f_id, f_name, f_type, f_op, f_order, f_show, f_total, ROUND(f_value, 2), ROUND(f_max, 2)
  FROM computed_values
  ORDER BY 1, 6;
END;
$$;

-- ---- get_class_all_fields: every field, every student, every
-- subject in a class, for one term — one bulk call for bulk report
-- card generation (avoids hundreds of individual queries). ----

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

  -- Authorization: this backs BulkReportCardPage (school_admin), and
  -- we also allow a teacher with access to this specific class (e.g.
  -- a form teacher printing report cards for their own class).
  -- SECURITY DEFINER bypasses RLS, so this is load-bearing.
  IF NOT COALESCE((
    is_super_admin()
    OR (current_school_id() = v_school_id AND current_user_role() = 'school_admin')
    OR (current_school_id() = v_school_id AND current_user_role() = 'teacher' AND teacher_has_class_access(p_class_id))
  ), FALSE) THEN
    RAISE EXCEPTION 'get_class_all_fields: not authorized for this class';
  END IF;

  RETURN QUERY
  WITH roster AS (
    SELECT DISTINCT student_enrollments.student_id FROM student_enrollments WHERE class_id = p_class_id
  ),
  class_subjects AS (
    -- Every subject that has at least one score recorded for this
    -- class/term, plus every subject a teacher is assigned for this
    -- class — covers subjects with zero scores entered yet too.
    SELECT DISTINCT student_scores.subject_id FROM student_scores WHERE class_id = p_class_id AND term_id = p_term_id
    UNION
    SELECT DISTINCT teacher_assignments.subject_id FROM teacher_assignments WHERE class_id = p_class_id AND teacher_assignments.subject_id IS NOT NULL
  ),
  input_values AS (
    SELECT
      r.student_id AS r_student, cs.subject_id AS r_subject,
      ac.id AS f_id, ac.name AS f_name, ac.field_type AS f_type, ac.compute_operation AS f_op,
      ac.order_index AS f_order, ac.show_on_report_card AS f_show, ac.is_total_field AS f_total,
      COALESCE(ss.score, 0) AS f_value, ac.max_score AS f_max
    FROM roster r
    CROSS JOIN class_subjects cs
    CROSS JOIN assessment_categories ac
    LEFT JOIN student_scores ss
      ON ss.assessment_category_id = ac.id
      AND ss.student_id = r.student_id
      AND ss.subject_id = cs.subject_id
      AND ss.term_id = p_term_id
    WHERE ac.school_id = v_school_id
      AND ac.field_type = 'input'
      AND ac.is_active = TRUE
  ),
  computed_values AS (
    SELECT
      iv.r_student, iv.r_subject,
      ac.id AS f_id, ac.name AS f_name, ac.field_type AS f_type, ac.compute_operation AS f_op,
      ac.order_index AS f_order, ac.show_on_report_card AS f_show, ac.is_total_field AS f_total,
      CASE ac.compute_operation
        WHEN 'sum' THEN SUM(iv.f_value * sfs.weight)
        WHEN 'average' THEN SUM(iv.f_value * sfs.weight) / NULLIF(SUM(sfs.weight), 0)
        WHEN 'weighted_percentage' THEN SUM((iv.f_value / NULLIF(iv.f_max, 0)) * sfs.weight)
      END AS f_value,
      CASE ac.compute_operation
        WHEN 'sum' THEN SUM(iv.f_max * sfs.weight)
        WHEN 'average' THEN SUM(iv.f_max * sfs.weight) / NULLIF(SUM(sfs.weight), 0)
        WHEN 'weighted_percentage' THEN SUM(sfs.weight)
      END AS f_max
    FROM assessment_categories ac
    JOIN score_field_sources sfs ON sfs.field_id = ac.id
    JOIN input_values iv ON iv.f_id = sfs.source_field_id
    WHERE ac.school_id = v_school_id
      AND ac.field_type = 'computed'
      AND ac.is_active = TRUE
    GROUP BY iv.r_student, iv.r_subject, ac.id, ac.name, ac.field_type, ac.compute_operation,
             ac.order_index, ac.show_on_report_card, ac.is_total_field
  )
  SELECT r_student, r_subject, f_id, f_name, f_type, f_op, f_order, f_show, f_total, ROUND(f_value, 2), ROUND(f_max, 2)
  FROM input_values
  UNION ALL
  SELECT r_student, r_subject, f_id, f_name, f_type, f_op, f_order, f_show, f_total, ROUND(f_value, 2), ROUND(f_max, 2)
  FROM computed_values
  ORDER BY 1, 2, 7;
END;
$$;

-- ---- get_school_term_totals: (student_id, class_id, subject_id,
-- percentage) for every student x subject in the school, for one
-- term — school-wide, total-field-only, for analytics. Deliberately
-- lean (no per-field breakdown, no embedded names — RPCs can't do
-- PostgREST-style embedded joins, so the caller joins class/subject
-- names by ID client-side). ----

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
  -- Authorization: this backs SchoolAdminAnalyticsPage. SECURITY
  -- DEFINER bypasses RLS, so this is load-bearing — without it any
  -- authenticated user could pass any p_school_id and read another
  -- school's whole-school analytics.
  IF NOT COALESCE((
    is_super_admin()
    OR (current_school_id() = p_school_id AND current_user_role() = 'school_admin')
  ), FALSE) THEN
    RAISE EXCEPTION 'get_school_term_totals: not authorized for this school';
  END IF;

  RETURN QUERY
  WITH totals AS (
    SELECT id, compute_operation AS op FROM assessment_categories
    WHERE school_id = p_school_id AND is_total_field = TRUE AND is_active = TRUE
    LIMIT 1
  ),
  pairs AS (
    -- Every (student, subject) that has at least one score entered
    -- this term, scoped to the school via class.
    SELECT DISTINCT ss.student_id, ss.class_id, ss.subject_id
    FROM student_scores ss
    WHERE ss.school_id = p_school_id AND ss.term_id = p_term_id
  ),
  input_values AS (
    SELECT
      p.student_id AS r_student, p.class_id AS r_class, p.subject_id AS r_subject,
      ac.id AS f_id,
      COALESCE(ss.score, 0) AS f_value, ac.max_score AS f_max
    FROM pairs p
    CROSS JOIN assessment_categories ac
    LEFT JOIN student_scores ss
      ON ss.assessment_category_id = ac.id
      AND ss.student_id = p.student_id
      AND ss.subject_id = p.subject_id
      AND ss.term_id = p_term_id
    WHERE ac.school_id = p_school_id
      AND ac.field_type = 'input'
      AND ac.is_active = TRUE
  )
  SELECT
    iv.r_student, iv.r_class, iv.r_subject,
    ROUND(
      CASE (SELECT op FROM totals)
        WHEN 'sum' THEN (SUM(iv.f_value * sfs.weight) / NULLIF(SUM(iv.f_max * sfs.weight), 0)) * 100
        WHEN 'average' THEN (SUM(iv.f_value * sfs.weight) / NULLIF(SUM(iv.f_max * sfs.weight), 0)) * 100
        WHEN 'weighted_percentage' THEN SUM((iv.f_value / NULLIF(iv.f_max, 0)) * sfs.weight)
      END
    , 2) AS percentage
  FROM input_values iv
  JOIN score_field_sources sfs ON sfs.source_field_id = iv.f_id AND sfs.field_id = (SELECT id FROM totals)
  WHERE (SELECT id FROM totals) IS NOT NULL
  GROUP BY iv.r_student, iv.r_class, iv.r_subject;
END;
$$;

GRANT EXECUTE ON FUNCTION get_score_fields(UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_class_subject_term_results(UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_class_all_fields(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_school_term_totals(UUID, UUID) TO authenticated;

-- ============================================================
-- PART C — RETIRE THE SUPERSEDED VIEWS
-- ============================================================
-- No code in the app queries these anymore (confirmed via a repo-wide
-- grep sweep). Leaving them in place would be actively dangerous, not
-- just unused: v_ca_broadsheet sums every row in student_scores per
-- subject/term, which as of the Part A data migration now INCLUDES
-- the migrated "Exam" field — and v_term_results then separately
-- re-joins the original exam_scores table on top of that, double-
-- counting the exam score for any school that has been migrated.
-- Dropping both rather than leaving a landmine for a future query.
DROP VIEW IF EXISTS v_term_results;
DROP VIEW IF EXISTS v_ca_broadsheet;

-- exam_scores itself is deliberately NOT dropped — it's kept as a
-- read-only historical archive of pre-migration data (and idb.ts's
-- offline sync-drain logic still targets it, to safely flush any
-- already-queued items from before this update). No code writes to
-- it or reads from it as a source of truth going forward.

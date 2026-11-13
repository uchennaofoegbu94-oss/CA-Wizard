-- 058_scores_never_hidden_by_groups.sql
--
-- PROBLEM (found by reproducing it on the real schema, 8 scored subject-entries):
-- 057 made "does this student take this subject?" depend ONLY on group membership
-- (or an elective tick). Any GAP in membership then silently erased real,
-- already-recorded results:
--   * Group membership is per SESSION and none exists for earlier sessions, so
--     restricting a subject hid every previous-session score for it;
--   * students not yet placed in a group lost the subject (and its scores);
--   * a LATER group change (Science -> Arts) hid scores that were already recorded.
-- The scores were never deleted, but they vanished from every surface that goes
-- through the group-aware functions (broadsheet, report cards, analytics) while
-- still showing in Score Entry, which reads the table directly: hence "some areas
-- and not others". Report-card snapshots frozen while scores were hidden also
-- stayed incomplete, so transcripts lagged behind.
--
-- THE RULE (replaces 057's):
--   A recorded score always keeps its subject visible.
--     takes  =  by-rule (groups / electives, exactly as in 057)
--               OR the student has a recorded (non-blank) score for the subject
--     - for lists (rosters, Score Entry, grids): any score in the SESSION counts
--     - for a term's RESULTS: a score in THAT TERM counts, so a student who moved
--       group mid-session does not gain an empty subject (and a 0 in their average)
--       in terms where they have no scores for it.
--   Groups still decide who takes a subject going forward; they can no longer
--   make existing results disappear. Nothing is moved or rewritten: scores were
--   never deleted, so the fix restores them everywhere at once, uniformly.
--
-- ALSO ADDED
--   * Roster rows carry `via_scores` (visible only because scores exist, not because of a
--     group/tick) and `has_scores` (the student has recorded scores in it at all), so
--     screens can show WHY and avoid offering an un-tick that cannot take effect.
--   * diagnose_hidden_scores() / list_hidden_scores(): for every recorded score that
--     is not simply visible, a REASON. Two statuses:
--       RESTORED      visible again only because scores exist (the group/tick is
--                     missing or different: tells you who still needs a group)
--       STILL_HIDDEN  hidden for a reason groups cannot fix (wrong layout, student not
--                     enrolled in the class the scores belong to, subject not offered
--                     at the level, field switched off), each with how to fix it
--   * diagnose_stale_snapshots(): report-card snapshots that predate the restore and are
--     missing subjects that now have scores (transcripts read snapshots).
--
-- NEW-SUPABASE-GRANTS RULE: no new tables here; function privileges are explicit below.

-- ───────────────────────── 1. The rule, in three layers ─────────────────────────
-- 1a. Group / elective rule exactly as 057 defined it (now internal-only)
CREATE OR REPLACE FUNCTION student_takes_subject_by_rule(p_student_id UUID, p_subject_id UUID, p_class_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT
    NOT EXISTS (
      SELECT 1 FROM classes c JOIN subject_offerings so ON so.class_level_id = c.class_level_id
      WHERE c.id = p_class_id AND so.subject_id = p_subject_id
    )
    OR EXISTS (
      SELECT 1 FROM classes c JOIN subject_offerings so ON so.class_level_id = c.class_level_id AND so.subject_id = p_subject_id
      WHERE c.id = p_class_id
        AND (NOT so.is_optional OR EXISTS (
              SELECT 1 FROM student_optional_subjects sos
              WHERE sos.student_id = p_student_id AND sos.subject_id = p_subject_id AND sos.session_id = c.session_id))
        AND (NOT EXISTS (SELECT 1 FROM subject_offering_groups g WHERE g.offering_id = so.id)
             OR EXISTS (
              SELECT 1 FROM subject_offering_groups g
              JOIN student_group_members m ON m.group_id = g.group_id AND m.student_id = p_student_id AND m.session_id = c.session_id
              WHERE g.offering_id = so.id))
    );
$$;

-- 1b. Has the student any recorded (non-blank) score in this subject during the class's SESSION?
CREATE OR REPLACE FUNCTION student_has_scores_in_session(p_student_id UUID, p_subject_id UUID, p_class_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1
    FROM classes c
    JOIN student_scores ss ON ss.student_id = p_student_id AND ss.subject_id = p_subject_id AND ss.score IS NOT NULL
    JOIN classes sc ON sc.id = ss.class_id AND sc.session_id = c.session_id
    WHERE c.id = p_class_id
  );
$$;

-- 1b'. Lists (rosters, Score Entry, grids): by rule, OR any recorded score in the SESSION keeps the subject
CREATE OR REPLACE FUNCTION student_takes_subject(p_student_id UUID, p_subject_id UUID, p_class_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT student_takes_subject_by_rule(p_student_id, p_subject_id, p_class_id)
      OR student_has_scores_in_session(p_student_id, p_subject_id, p_class_id);
$$;

-- 1c. A term's results: a recorded score in THAT TERM keeps the subject
CREATE OR REPLACE FUNCTION student_takes_subject_in_term(p_student_id UUID, p_subject_id UUID, p_class_id UUID, p_term_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT student_takes_subject_by_rule(p_student_id, p_subject_id, p_class_id)
      OR EXISTS (
        SELECT 1 FROM student_scores ss
        WHERE ss.student_id = p_student_id AND ss.subject_id = p_subject_id AND ss.term_id = p_term_id AND ss.score IS NOT NULL
      );
$$;

REVOKE EXECUTE ON FUNCTION student_takes_subject_by_rule(UUID, UUID, UUID)       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION student_has_scores_in_session(UUID, UUID, UUID)      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION student_takes_subject(UUID, UUID, UUID)              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION student_takes_subject_in_term(UUID, UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;

-- ───────────────────────── 2. Every scoring function now uses the new rule ─────────────────────────
-- (definitions are the deployed ones; the only change is which "takes" function they call)

-- 2a. single-student report card path
CREATE OR REPLACE FUNCTION public.get_score_fields(p_student_id uuid, p_subject_id uuid, p_term_id uuid)
 RETURNS TABLE(field_id uuid, field_name text, field_type score_field_type, compute_operation score_compute_operation, order_index integer, show_on_report_card boolean, show_on_score_entry boolean, is_total_field boolean, value numeric, max_value numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_school_id UUID; v_class UUID;
BEGIN
  SELECT school_id INTO v_school_id FROM students WHERE id = p_student_id;
  IF v_school_id IS NULL THEN RAISE EXCEPTION 'get_score_fields: student not found'; END IF;
  IF NOT COALESCE((is_super_admin() OR (current_school_id() = v_school_id AND current_user_role() = 'school_admin')), FALSE) THEN
    RAISE EXCEPTION 'get_score_fields: not authorized for this student''s school';
  END IF;
  v_class := class_for_student_term(p_student_id, p_term_id);
  IF v_class IS NOT NULL AND NOT student_takes_subject_in_term(p_student_id, p_subject_id, v_class, p_term_id) THEN
    RETURN;  -- the student does not take this subject
  END IF;
  RETURN QUERY SELECT * FROM resolve_score_fields(v_school_id, p_student_id, p_subject_id, p_term_id, layout_for_student_term(p_student_id, p_term_id));
END;
$function$;

-- 2b. one subject, whole class (Score Entry preview, broadsheets, report-card ranking)
CREATE OR REPLACE FUNCTION public.get_class_subject_term_results(p_class_id uuid, p_subject_id uuid, p_term_id uuid)
 RETURNS TABLE(student_id uuid, field_id uuid, field_name text, field_type score_field_type, compute_operation score_compute_operation, order_index integer, show_on_report_card boolean, show_on_score_entry boolean, is_total_field boolean, value numeric, max_value numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_school_id UUID; v_layout UUID;
BEGIN
  SELECT school_id INTO v_school_id FROM classes WHERE id = p_class_id;
  IF v_school_id IS NULL THEN RAISE EXCEPTION 'get_class_subject_term_results: class not found'; END IF;
  IF NOT COALESCE((
    is_super_admin()
    OR (current_school_id() = v_school_id AND current_user_role() = 'school_admin')
    OR (current_school_id() = v_school_id AND current_user_role() = 'teacher' AND teacher_has_class_access(p_class_id))
    OR (current_school_id() = v_school_id AND has_section_permission(p_class_id, 'can_download_documents'))
  ), FALSE) THEN
    RAISE EXCEPTION 'get_class_subject_term_results: not authorized for this class';
  END IF;
  v_layout := layout_for_class(p_class_id);
  RETURN QUERY
  SELECT r.student_id, rf.*
  FROM (SELECT DISTINCT se.student_id FROM student_enrollments se WHERE se.class_id = p_class_id) r
  CROSS JOIN LATERAL resolve_score_fields(v_school_id, r.student_id, p_subject_id, p_term_id, v_layout) rf
  WHERE student_takes_subject_in_term(r.student_id, p_subject_id, p_class_id, p_term_id)
  ORDER BY r.student_id, rf.order_index;
END;
$function$;

-- 2c. every subject, whole class (bulk report cards)
CREATE OR REPLACE FUNCTION public.get_class_all_fields(p_class_id uuid, p_term_id uuid)
 RETURNS TABLE(student_id uuid, subject_id uuid, field_id uuid, field_name text, field_type score_field_type, compute_operation score_compute_operation, order_index integer, show_on_report_card boolean, show_on_score_entry boolean, is_total_field boolean, value numeric, max_value numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_school_id UUID; v_layout UUID;
BEGIN
  SELECT school_id INTO v_school_id FROM classes WHERE id = p_class_id;
  IF v_school_id IS NULL THEN RAISE EXCEPTION 'get_class_all_fields: class not found'; END IF;
  IF NOT COALESCE((
    is_super_admin()
    OR (current_school_id() = v_school_id AND current_user_role() = 'school_admin')
    OR (current_school_id() = v_school_id AND current_user_role() = 'teacher' AND teacher_has_class_access(p_class_id))
    OR (current_school_id() = v_school_id AND has_section_permission(p_class_id, 'can_download_documents'))
  ), FALSE) THEN
    RAISE EXCEPTION 'get_class_all_fields: not authorized for this class';
  END IF;
  v_layout := layout_for_class(p_class_id);
  RETURN QUERY
  SELECT r.student_id, cs.subject_id, rf.*
  FROM (SELECT DISTINCT se.student_id FROM student_enrollments se WHERE se.class_id = p_class_id) r
  CROSS JOIN (
    SELECT DISTINCT ss.subject_id FROM student_scores ss WHERE ss.class_id = p_class_id AND ss.term_id = p_term_id
    UNION
    SELECT DISTINCT ta.subject_id FROM teacher_assignments ta WHERE ta.class_id = p_class_id AND ta.subject_id IS NOT NULL
  ) cs
  CROSS JOIN LATERAL resolve_score_fields(v_school_id, r.student_id, cs.subject_id, p_term_id, v_layout) rf
  WHERE student_takes_subject_in_term(r.student_id, cs.subject_id, p_class_id, p_term_id)
  ORDER BY r.student_id, cs.subject_id, rf.order_index;
END;
$function$;

-- 2d. school-wide totals (analytics)
CREATE OR REPLACE FUNCTION public.get_school_term_totals(p_school_id uuid, p_term_id uuid)
 RETURNS TABLE(student_id uuid, class_id uuid, subject_id uuid, percentage numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT COALESCE((is_super_admin() OR (current_school_id() = p_school_id AND current_user_role() = 'school_admin')), FALSE) THEN
    RAISE EXCEPTION 'get_school_term_totals: not authorized for this school';
  END IF;
  RETURN QUERY
  SELECT p.student_id, p.class_id, p.subject_id, ROUND((rf.value / NULLIF(rf.max_value, 0)) * 100, 2)
  FROM (
    SELECT DISTINCT ss.student_id, ss.class_id, ss.subject_id
    FROM student_scores ss WHERE ss.school_id = p_school_id AND ss.term_id = p_term_id
  ) p
  CROSS JOIN LATERAL resolve_score_fields(p_school_id, p.student_id, p.subject_id, p_term_id, layout_for_class(p.class_id)) rf
  WHERE rf.is_total_field AND student_takes_subject_in_term(p.student_id, p.subject_id, p.class_id, p_term_id);
END;
$function$;

-- 2e. roster (IF EXISTS so the whole migration is safe to re-run): gains via_scores (visible ONLY because scores exist, not by group/tick) and has_scores (any recorded
--     score at all: such a student's tick/group cannot be removed by un-ticking). Return type changes, so drop + recreate.
DROP FUNCTION IF EXISTS get_class_subject_roster(UUID);
CREATE FUNCTION public.get_class_subject_roster(p_class_id uuid)
 RETURNS TABLE(student_id uuid, subject_id uuid, is_optional boolean, via_scores boolean, has_scores boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_school UUID;
BEGIN
  SELECT school_id INTO v_school FROM classes WHERE id = p_class_id;
  IF v_school IS NULL THEN RAISE EXCEPTION 'get_class_subject_roster: class not found'; END IF;
  IF NOT COALESCE((
    is_super_admin()
    OR (current_school_id() = v_school AND current_user_role() = 'school_admin')
    OR (current_school_id() = v_school AND current_user_role() = 'teacher' AND teacher_has_class_access(p_class_id))
    OR (current_school_id() = v_school AND has_section_permission(p_class_id, 'can_enroll_students'))
    OR (current_school_id() = v_school AND has_section_permission(p_class_id, 'can_assign_teachers'))
    OR (current_school_id() = v_school AND has_section_permission(p_class_id, 'can_download_documents'))
  ), FALSE) THEN
    RAISE EXCEPTION 'get_class_subject_roster: not authorized for this class';
  END IF;
  RETURN QUERY
  SELECT r.student_id, so.subject_id, so.is_optional, NOT student_takes_subject_by_rule(r.student_id, so.subject_id, p_class_id), student_has_scores_in_session(r.student_id, so.subject_id, p_class_id)
  FROM (SELECT DISTINCT se.student_id FROM student_enrollments se WHERE se.class_id = p_class_id) r
  JOIN classes c ON c.id = p_class_id
  JOIN subject_offerings so ON so.class_level_id = c.class_level_id
  WHERE student_takes_subject(r.student_id, so.subject_id, p_class_id);
END $function$;
REVOKE EXECUTE ON FUNCTION get_class_subject_roster(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION get_class_subject_roster(UUID) TO authenticated;

-- 2f. set_subject_audience: its returned count now means "students with scores who are outside the audience and KEEP the subject"
CREATE OR REPLACE FUNCTION public.set_subject_audience(p_subject_id uuid, p_class_level_id uuid, p_mode text, p_group_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_school UUID; v_offering UUID; v_profile UUID; v_n INTEGER := 0; v_gid UUID;
BEGIN
  SELECT id, school_id INTO v_offering, v_school FROM subject_offerings WHERE subject_id = p_subject_id AND class_level_id = p_class_level_id;
  IF v_offering IS NULL THEN RAISE EXCEPTION 'set_subject_audience: this subject is not offered at that class level'; END IF;
  IF NOT COALESCE(is_super_admin() OR (current_school_id() = v_school AND current_user_role() = 'school_admin'), FALSE) THEN
    RAISE EXCEPTION 'set_subject_audience: only a school admin can do this';
  END IF;
  IF p_mode NOT IN ('everyone', 'groups', 'choice') THEN
    RAISE EXCEPTION 'set_subject_audience: mode must be everyone, groups or choice';
  END IF;
  IF p_mode = 'groups' AND COALESCE(array_length(p_group_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'set_subject_audience: choose at least one group';
  END IF;
  SELECT id INTO v_profile FROM profiles WHERE user_id = auth.uid();

  -- start clean: one mode at a time
  DELETE FROM subject_offering_groups WHERE offering_id = v_offering;

  IF p_mode = 'groups' THEN
    UPDATE subject_offerings SET is_optional = FALSE WHERE id = v_offering;
    FOREACH v_gid IN ARRAY p_group_ids LOOP
      INSERT INTO subject_offering_groups (offering_id, group_id, school_id) VALUES (v_offering, v_gid, v_school);
    END LOOP;
    SELECT count(DISTINCT ss.student_id) INTO v_n
    FROM student_scores ss JOIN classes c ON c.id = ss.class_id
    WHERE ss.subject_id = p_subject_id AND c.class_level_id = p_class_level_id AND ss.school_id = v_school
      AND NOT student_takes_subject_by_rule(ss.student_id, p_subject_id, ss.class_id);
  ELSIF p_mode = 'choice' THEN
    UPDATE subject_offerings SET is_optional = TRUE WHERE id = v_offering;
    -- keep every student who already has scores (same safeguard as 055)
    INSERT INTO student_optional_subjects (school_id, student_id, subject_id, session_id, created_by)
    SELECT DISTINCT v_school, ss.student_id, p_subject_id, c.session_id, v_profile
    FROM student_scores ss JOIN classes c ON c.id = ss.class_id
    WHERE ss.subject_id = p_subject_id AND c.class_level_id = p_class_level_id AND ss.school_id = v_school
      AND EXISTS (SELECT 1 FROM student_enrollments se WHERE se.student_id = ss.student_id AND se.session_id = c.session_id)
    ON CONFLICT (student_id, subject_id, session_id) DO NOTHING;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  ELSE
    UPDATE subject_offerings SET is_optional = FALSE WHERE id = v_offering;
  END IF;
  RETURN v_n;
END $function$;

-- ───────────────────────── 3. Why is a score not simply visible? ─────────────────────────
-- Internal classifier: one row per recorded (non-blank) score that is NOT plainly visible.
--   status RESTORED      visible only because the score exists; the group/tick that should
--                        put the subject on the student's record is missing or different
--   status STILL_HIDDEN  hidden for a reason groups cannot fix
-- Precedence for STILL_HIDDEN: layout, enrolment, offering, field switch.
CREATE OR REPLACE FUNCTION classify_hidden_scores(p_school_id UUID)
RETURNS TABLE(score_id UUID, status TEXT, reason TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH base AS (
    SELECT ss.id, ss.student_id, ss.subject_id, ss.class_id, c.session_id, c.class_level_id, ac.layout_id, ac.is_active
    FROM student_scores ss
    JOIN classes c ON c.id = ss.class_id
    JOIN assessment_categories ac ON ac.id = ss.assessment_category_id
    WHERE ss.score IS NOT NULL AND (p_school_id IS NULL OR ss.school_id = p_school_id)
  ), flags AS (
    SELECT b.*,
      EXISTS (SELECT 1 FROM student_enrollments se WHERE se.student_id = b.student_id AND se.class_id = b.class_id) AS enrolled,
      EXISTS (SELECT 1 FROM subject_offerings so WHERE so.subject_id = b.subject_id AND so.class_level_id = b.class_level_id) AS offered,
      (b.layout_id IS NOT DISTINCT FROM layout_for_class(b.class_id)) AS layout_ok,
      student_takes_subject_by_rule(b.student_id, b.subject_id, b.class_id) AS by_rule
    FROM base b
  ), offer AS (
    SELECT f.*, o.id AS offering_id, o.is_optional,
      (SELECT g.type_id FROM subject_offering_groups sog JOIN student_groups g ON g.id = sog.group_id
        WHERE sog.offering_id = o.id LIMIT 1) AS aud_type
    FROM flags f
    LEFT JOIN subject_offerings o ON o.subject_id = f.subject_id AND o.class_level_id = f.class_level_id
  ), why AS (
    SELECT x.*,
      (SELECT m.group_id FROM student_group_members m
        WHERE m.student_id = x.student_id AND m.session_id = x.session_id AND m.type_id = x.aud_type) AS my_group,
      EXISTS (SELECT 1 FROM student_group_members m
        WHERE m.student_id = x.student_id AND m.type_id = x.aud_type AND m.session_id <> x.session_id) AS group_in_other_session
    FROM offer x
  )
  SELECT w.id,
    CASE WHEN NOT w.layout_ok OR NOT w.enrolled OR NOT w.offered OR NOT w.is_active THEN 'STILL_HIDDEN' ELSE 'RESTORED' END,
    CASE
      WHEN NOT w.layout_ok THEN 'WRONG_LAYOUT'
      WHEN NOT w.enrolled  THEN 'NOT_ENROLLED_IN_CLASS'
      WHEN NOT w.offered   THEN 'SUBJECT_NOT_OFFERED'
      WHEN NOT w.is_active THEN 'FIELD_INACTIVE'
      WHEN w.aud_type IS NOT NULL AND w.my_group IS NULL AND w.group_in_other_session THEN 'GROUP_ONLY_IN_OTHER_SESSION'
      WHEN w.aud_type IS NOT NULL AND w.my_group IS NULL THEN 'NO_GROUP_ASSIGNED'
      WHEN w.aud_type IS NOT NULL THEN 'IN_DIFFERENT_GROUP'
      WHEN w.is_optional THEN 'NOT_OPTED_IN'
      ELSE 'OTHER'
    END
  FROM why w
  WHERE NOT (w.by_rule AND w.layout_ok AND w.enrolled AND w.offered AND w.is_active);
$$;
REVOKE EXECUTE ON FUNCTION classify_hidden_scores(UUID) FROM PUBLIC, anon, authenticated;

-- Summary: what, how many, what it means, how to fix it
CREATE OR REPLACE FUNCTION diagnose_hidden_scores(p_school_id UUID DEFAULT NULL)
RETURNS TABLE(status TEXT, reason TEXT, scores BIGINT, students BIGINT, what_it_means TEXT, how_to_fix TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF NOT layout_tools_allowed(p_school_id) THEN
    RAISE EXCEPTION 'diagnose_hidden_scores: not authorized (school admins must pass their own school id)';
  END IF;
  RETURN QUERY
  SELECT k.status, k.reason, count(*)::BIGINT, count(DISTINCT ss.student_id)::BIGINT, t.meaning, t.fix
  FROM classify_hidden_scores(p_school_id) k
  JOIN student_scores ss ON ss.id = k.score_id
  JOIN (VALUES
    ('WRONG_LAYOUT', 'The score is recorded against a field from a different assessment layout than this class uses — usually typed in an out-of-date copy of the app.', 'Press "Repair layout scores" (moves each to the same-named field of the class''s layout). Conflicts are left for you to review.'),
    ('NOT_ENROLLED_IN_CLASS', 'The student has no enrolment in the class these scores were recorded in (moved to another class or unenrolled), so class-based screens never list them.', 'Re-enrol the student in that class (or move the scores to the class they are in now).'),
    ('SUBJECT_NOT_OFFERED', 'The subject is not offered at this class''s level, so report cards and broadsheets have no column for it.', 'Offer it again under Subjects → Class Level Offerings.'),
    ('FIELD_INACTIVE', 'The assessment field these scores belong to is switched off, so totals ignore it.', 'Switch the field back on under Assessments.'),
    ('GROUP_ONLY_IN_OTHER_SESSION', 'The subject is restricted to a group, and the student has a group only in a different session. The scores now show regardless.', 'Set the student''s group for THIS session (class page → Student Groups) so the subject is theirs by rule, not only by their scores.'),
    ('NO_GROUP_ASSIGNED', 'The subject is restricted to a group and the student has no group yet. The scores now show regardless.', 'Put the student in their group (class page → Student Groups).'),
    ('IN_DIFFERENT_GROUP', 'The subject is restricted to a group the student is not in (for example they changed streams after scores were recorded). The scores stay visible.', 'Nothing is lost. If the change was a mistake, correct the student''s group; if they really changed, clear the unwanted scores in Score Entry to drop the subject.'),
    ('NOT_OPTED_IN', 'The subject is chosen student-by-student and this student has not been ticked. The scores show regardless.', 'Tick the student under the class''s Subject Choices.'),
    ('OTHER', 'Not plainly visible for a reason that is not classified.', 'Check the student''s enrolment and the subject''s offering for this class.')
  ) AS t(reason, meaning, fix) ON t.reason = k.reason
  GROUP BY k.status, k.reason, t.meaning, t.fix
  ORDER BY (k.status = 'STILL_HIDDEN') DESC, count(*) DESC;
END $$;

-- Detail: who / which subject / which term, with the reason
CREATE OR REPLACE FUNCTION list_hidden_scores(p_school_id UUID DEFAULT NULL, p_limit INTEGER DEFAULT 500)
RETURNS TABLE(status TEXT, reason TEXT, student_name TEXT, admission_number TEXT, session_name TEXT,
              class_name TEXT, subject_name TEXT, term_name TEXT, field_name TEXT, score NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF NOT layout_tools_allowed(p_school_id) THEN
    RAISE EXCEPTION 'list_hidden_scores: not authorized (school admins must pass their own school id)';
  END IF;
  RETURN QUERY
  SELECT k.status, k.reason, st.last_name || ', ' || st.first_name, st.admission_number, se.name,
         cl.name || COALESCE(' ' || ca.name, ''), sj.name, t.name::TEXT, ac.name, ss.score
  FROM classify_hidden_scores(p_school_id) k
  JOIN student_scores ss ON ss.id = k.score_id
  JOIN students st ON st.id = ss.student_id
  JOIN subjects sj ON sj.id = ss.subject_id
  JOIN terms t ON t.id = ss.term_id
  JOIN assessment_categories ac ON ac.id = ss.assessment_category_id
  JOIN classes c ON c.id = ss.class_id
  JOIN sessions se ON se.id = c.session_id
  JOIN class_levels cl ON cl.id = c.class_level_id
  LEFT JOIN class_arms ca ON ca.id = c.class_arm_id
  ORDER BY (k.status = 'STILL_HIDDEN') DESC, se.start_year DESC, cl.name, st.last_name, sj.name
  LIMIT GREATEST(p_limit, 1);
END $$;

-- Report-card snapshots (what transcripts read) that are missing a subject that has scores
CREATE OR REPLACE FUNCTION diagnose_stale_snapshots(p_school_id UUID DEFAULT NULL)
RETURNS TABLE(snapshot_id UUID, student_name TEXT, admission_number TEXT, session_name TEXT, session_id UUID, class_id UUID,
              class_name TEXT, term_id UUID, term_name TEXT, missing_subjects TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF NOT layout_tools_allowed(p_school_id) THEN
    RAISE EXCEPTION 'diagnose_stale_snapshots: not authorized (school admins must pass their own school id)';
  END IF;
  RETURN QUERY
  SELECT rs.id, st.last_name || ', ' || st.first_name, st.admission_number, se.name, se.id, rs.class_id,
         cl.name || COALESCE(' ' || ca.name, ''), rs.term_id, t.name::TEXT,
         string_agg(sj.name, ', ' ORDER BY sj.name)
  FROM report_snapshots rs
  JOIN students st ON st.id = rs.student_id
  JOIN classes c ON c.id = rs.class_id
  JOIN class_levels cl ON cl.id = c.class_level_id
  LEFT JOIN class_arms ca ON ca.id = c.class_arm_id
  JOIN sessions se ON se.id = c.session_id
  JOIN terms t ON t.id = rs.term_id
  CROSS JOIN LATERAL (
    SELECT DISTINCT ss.subject_id
    FROM student_scores ss
    WHERE ss.student_id = rs.student_id AND ss.term_id = rs.term_id AND ss.score IS NOT NULL
      AND EXISTS (SELECT 1 FROM subject_offerings so WHERE so.subject_id = ss.subject_id AND so.class_level_id = c.class_level_id)
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(rs.snapshot_data -> 'subjects', '[]'::jsonb)) e
        WHERE e -> 'subject' ->> 'id' = ss.subject_id::TEXT)
  ) ms
  JOIN subjects sj ON sj.id = ms.subject_id
  WHERE (p_school_id IS NULL OR rs.school_id = p_school_id)
  GROUP BY rs.id, st.last_name, st.first_name, st.admission_number, se.name, se.id, rs.class_id, cl.name, ca.name, rs.term_id, t.name
  ORDER BY se.name DESC, cl.name, st.last_name;
END $$;

REVOKE EXECUTE ON FUNCTION diagnose_hidden_scores(UUID)        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION list_hidden_scores(UUID, INTEGER)   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION diagnose_stale_snapshots(UUID)      FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION diagnose_hidden_scores(UUID)        TO authenticated;
GRANT  EXECUTE ON FUNCTION list_hidden_scores(UUID, INTEGER)   TO authenticated;
GRANT  EXECUTE ON FUNCTION diagnose_stale_snapshots(UUID)      TO authenticated;

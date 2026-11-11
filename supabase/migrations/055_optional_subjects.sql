-- 055_optional_subjects.sql
--
-- OPTIONAL (elective) SUBJECTS. An arts student should not carry Physics on
-- their records; a science student should not carry Government.
--
-- Model
--   * subject_offerings.is_optional  — per CLASS LEVEL, so Physics can be an
--     elective in SS1-SS3 while staying compulsory elsewhere. Default FALSE:
--     every existing subject stays compulsory and nothing changes until an
--     admin flips the switch.
--   * student_optional_subjects      — which students TAKE an optional subject,
--     per SESSION (electives are chosen yearly and can change). Keyed by
--     session, not class, so a mid-session class move keeps the choice.
--   * student_takes_subject()        — the ONE definition of "does this
--     student take this subject in this class". Every scoring RPC filters
--     through it, so Score Entry, broadsheets, report cards, transcripts'
--     source data and analytics cannot disagree.
--
-- Data-safety decisions
--   * Making a subject optional auto-enrols every student who ALREADY has
--     scores in it (set_subject_optional). Without this, flipping the switch
--     would silently hide existing results.
--   * Choices that stop being relevant (subject made compulsory again) are
--     ignored, not deleted, so they reappear correctly if it flips back.
--   * Scores are never deleted when a student drops a subject; they are
--     just no longer shown/counted.
--
-- Who may manage choices: school admin, or a section admin holding
-- can_enroll_students for the student's class's section (choosing electives
-- is part of enrolling a student).
--
-- NEW-SUPABASE-GRANTS RULE: explicit GRANTs for the new table are below.

-- ───────────────────────── 1. Offering flag ─────────────────────────
ALTER TABLE subject_offerings ADD COLUMN is_optional BOOLEAN NOT NULL DEFAULT FALSE;

-- ───────────────────────── 2. Choices table ─────────────────────────
CREATE TABLE student_optional_subjects (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id   UUID NOT NULL REFERENCES schools(id)  ON DELETE CASCADE,
  student_id  UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subject_id  UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  session_id  UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  created_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, subject_id, session_id)
);
CREATE INDEX idx_sos_school_id  ON student_optional_subjects(school_id);
CREATE INDEX idx_sos_session    ON student_optional_subjects(session_id);
CREATE INDEX idx_sos_subject    ON student_optional_subjects(subject_id);

ALTER TABLE student_optional_subjects ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_optional_subjects TO authenticated;
GRANT ALL ON public.student_optional_subjects TO service_role;

-- ───────────────────────── 3. Helpers ─────────────────────────
-- THE definition. Compulsory unless the class level's offering is optional,
-- in which case the student must have opted in for that class's session.
-- (A subject with no offering row at all — legacy/teacher-assigned only — counts as compulsory.)
CREATE OR REPLACE FUNCTION student_takes_subject(p_student_id UUID, p_subject_id UUID, p_class_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT
    NOT EXISTS (
      SELECT 1 FROM classes c JOIN subject_offerings so ON so.class_level_id = c.class_level_id
      WHERE c.id = p_class_id AND so.subject_id = p_subject_id AND so.is_optional
    )
    OR EXISTS (
      SELECT 1 FROM classes c JOIN student_optional_subjects sos ON sos.session_id = c.session_id
      WHERE c.id = p_class_id AND sos.student_id = p_student_id AND sos.subject_id = p_subject_id
    );
$$;

-- Class a student was in for a term's session (latest enrolment wins)
CREATE OR REPLACE FUNCTION class_for_student_term(p_student_id UUID, p_term_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT se.class_id FROM student_enrollments se JOIN terms t ON t.session_id = se.session_id
  WHERE se.student_id = p_student_id AND t.id = p_term_id
  ORDER BY se.enrolled_at DESC LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION can_manage_student_electives(p_student_id UUID, p_session_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(
    is_super_admin()
    OR (current_school_id() = s.school_id AND current_user_role() = 'school_admin')
    OR EXISTS (
      SELECT 1 FROM student_enrollments se
      WHERE se.student_id = p_student_id AND se.session_id = p_session_id
        AND se.school_id = current_school_id()
        AND has_section_permission(se.class_id, 'can_enroll_students')
    ), FALSE)
  FROM students s WHERE s.id = p_student_id;
$$;

-- A choice row is only valid for a subject that IS optional at the level of
-- a class the student is enrolled in for that session, all in one school.
CREATE OR REPLACE FUNCTION check_student_optional_subject()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM students WHERE id = NEW.student_id AND school_id = NEW.school_id)
     OR NOT EXISTS (SELECT 1 FROM subjects WHERE id = NEW.subject_id AND school_id = NEW.school_id)
     OR NOT EXISTS (SELECT 1 FROM sessions WHERE id = NEW.session_id AND school_id = NEW.school_id) THEN
    RAISE EXCEPTION 'student_optional_subjects: student, subject and session must belong to the same school';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM student_enrollments se
    JOIN classes c ON c.id = se.class_id
    JOIN subject_offerings so ON so.class_level_id = c.class_level_id AND so.subject_id = NEW.subject_id AND so.is_optional
    WHERE se.student_id = NEW.student_id AND se.session_id = NEW.session_id
  ) THEN
    RAISE EXCEPTION 'student_optional_subjects: this subject is not an optional subject for the student''s class in that session';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_check_student_optional_subject BEFORE INSERT ON student_optional_subjects
  FOR EACH ROW EXECUTE FUNCTION check_student_optional_subject();

-- ───────────────────────── 4. RLS ─────────────────────────
CREATE POLICY super_admin_student_optional_subjects ON student_optional_subjects FOR ALL USING (is_super_admin());
CREATE POLICY school_member_read_student_optional_subjects ON student_optional_subjects FOR SELECT USING (school_id = current_school_id());
CREATE POLICY elective_manager_insert ON student_optional_subjects FOR INSERT
  WITH CHECK (school_id = current_school_id() AND can_manage_student_electives(student_id, session_id));
CREATE POLICY elective_manager_delete ON student_optional_subjects FOR DELETE
  USING (school_id = current_school_id() AND can_manage_student_electives(student_id, session_id));
-- (no UPDATE policy: a choice is added or removed, never edited)

-- ───────────────────────── 5. RPCs ─────────────────────────
-- Flip a subject optional/compulsory for a class level (school admin only).
-- Going optional auto-enrols every student who already has scores in it.
CREATE OR REPLACE FUNCTION set_subject_optional(p_subject_id UUID, p_class_level_id UUID, p_optional BOOLEAN)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_school UUID; v_profile UUID; v_enrolled INTEGER := 0;
BEGIN
  SELECT school_id INTO v_school FROM subject_offerings WHERE subject_id = p_subject_id AND class_level_id = p_class_level_id;
  IF v_school IS NULL THEN RAISE EXCEPTION 'set_subject_optional: this subject is not offered at that class level'; END IF;
  IF NOT COALESCE(is_super_admin() OR (current_school_id() = v_school AND current_user_role() = 'school_admin'), FALSE) THEN
    RAISE EXCEPTION 'set_subject_optional: only a school admin can do this';
  END IF;
  SELECT id INTO v_profile FROM profiles WHERE user_id = auth.uid();

  UPDATE subject_offerings SET is_optional = p_optional WHERE subject_id = p_subject_id AND class_level_id = p_class_level_id;

  IF p_optional THEN
    -- keep every student who already has recorded scores (per session of the class they were scored in)
    INSERT INTO student_optional_subjects (school_id, student_id, subject_id, session_id, created_by)
    SELECT DISTINCT v_school, ss.student_id, p_subject_id, c.session_id, v_profile
    FROM student_scores ss
    JOIN classes c ON c.id = ss.class_id
    WHERE ss.subject_id = p_subject_id AND c.class_level_id = p_class_level_id AND ss.school_id = v_school
      AND EXISTS (SELECT 1 FROM student_enrollments se WHERE se.student_id = ss.student_id AND se.session_id = c.session_id)
    ON CONFLICT (student_id, subject_id, session_id) DO NOTHING;
    GET DIAGNOSTICS v_enrolled = ROW_COUNT;
  END IF;
  RETURN v_enrolled;
END $$;

-- Set exactly which of the given students take one optional subject in a class's session
CREATE OR REPLACE FUNCTION set_class_subject_takers(p_class_id UUID, p_subject_id UUID, p_student_ids UUID[], p_takes BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_school UUID; v_session UUID; v_profile UUID; v_sid UUID;
BEGIN
  SELECT school_id, session_id INTO v_school, v_session FROM classes WHERE id = p_class_id;
  IF v_school IS NULL THEN RAISE EXCEPTION 'set_class_subject_takers: class not found'; END IF;
  IF NOT COALESCE(is_super_admin()
      OR (current_school_id() = v_school AND current_user_role() = 'school_admin')
      OR (current_school_id() = v_school AND has_section_permission(p_class_id, 'can_enroll_students')), FALSE) THEN
    RAISE EXCEPTION 'set_class_subject_takers: not authorized for this class';
  END IF;
  SELECT id INTO v_profile FROM profiles WHERE user_id = auth.uid();
  FOREACH v_sid IN ARRAY p_student_ids LOOP
    -- only students actually enrolled in THIS class
    IF NOT EXISTS (SELECT 1 FROM student_enrollments WHERE student_id = v_sid AND class_id = p_class_id) THEN CONTINUE; END IF;
    IF p_takes THEN
      INSERT INTO student_optional_subjects (school_id, student_id, subject_id, session_id, created_by)
      VALUES (v_school, v_sid, p_subject_id, v_session, v_profile) ON CONFLICT (student_id, subject_id, session_id) DO NOTHING;
    ELSE
      DELETE FROM student_optional_subjects WHERE student_id = v_sid AND subject_id = p_subject_id AND session_id = v_session;
    END IF;
  END LOOP;
END $$;

-- Promotion helper: copy last session's elective choices to the new class's session,
-- but only for subjects that are optional at the new class's level.
CREATE OR REPLACE FUNCTION carry_forward_optional_subjects(p_class_id UUID, p_student_ids UUID[])
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_school UUID; v_session UUID; v_level UUID; v_profile UUID; v_n INTEGER;
BEGIN
  SELECT school_id, session_id, class_level_id INTO v_school, v_session, v_level FROM classes WHERE id = p_class_id;
  IF v_school IS NULL THEN RAISE EXCEPTION 'carry_forward_optional_subjects: class not found'; END IF;
  IF NOT COALESCE(is_super_admin() OR (current_school_id() = v_school AND current_user_role() = 'school_admin'), FALSE) THEN
    RAISE EXCEPTION 'carry_forward_optional_subjects: only a school admin can do this';
  END IF;
  SELECT id INTO v_profile FROM profiles WHERE user_id = auth.uid();
  INSERT INTO student_optional_subjects (school_id, student_id, subject_id, session_id, created_by)
  SELECT DISTINCT v_school, prev.student_id, prev.subject_id, v_session, v_profile
  FROM student_optional_subjects prev
  JOIN subject_offerings so ON so.subject_id = prev.subject_id AND so.class_level_id = v_level AND so.is_optional
  WHERE prev.student_id = ANY(p_student_ids) AND prev.session_id <> v_session
    AND EXISTS (SELECT 1 FROM student_enrollments se WHERE se.student_id = prev.student_id AND se.class_id = p_class_id)
  ON CONFLICT (student_id, subject_id, session_id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- One call for every screen: who takes what in a class
CREATE OR REPLACE FUNCTION get_class_subject_roster(p_class_id UUID)
RETURNS TABLE(student_id UUID, subject_id UUID, is_optional BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
  SELECT r.student_id, so.subject_id, so.is_optional
  FROM (SELECT DISTINCT se.student_id FROM student_enrollments se WHERE se.class_id = p_class_id) r
  JOIN classes c ON c.id = p_class_id
  JOIN subject_offerings so ON so.class_level_id = c.class_level_id
  WHERE student_takes_subject(r.student_id, so.subject_id, p_class_id);
END $$;

REVOKE EXECUTE ON FUNCTION set_subject_optional(UUID, UUID, BOOLEAN)                 FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION set_class_subject_takers(UUID, UUID, UUID[], BOOLEAN)     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION carry_forward_optional_subjects(UUID, UUID[])             FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION get_class_subject_roster(UUID)                            FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION set_subject_optional(UUID, UUID, BOOLEAN)                 TO authenticated;
GRANT  EXECUTE ON FUNCTION set_class_subject_takers(UUID, UUID, UUID[], BOOLEAN)     TO authenticated;
GRANT  EXECUTE ON FUNCTION carry_forward_optional_subjects(UUID, UUID[])             TO authenticated;
GRANT  EXECUTE ON FUNCTION get_class_subject_roster(UUID)                            TO authenticated;
-- internal helpers: not for the API
REVOKE EXECUTE ON FUNCTION student_takes_subject(UUID, UUID, UUID)   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION class_for_student_term(UUID, UUID)        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION can_manage_student_electives(UUID, UUID)  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION can_manage_student_electives(UUID, UUID)  TO authenticated;   -- used inside RLS policies

-- ───────────────────────── 6. Scoring RPCs now honour optional subjects ─────────────────────────
-- Non-takers produce NO rows, so every consumer (Score Entry, broadsheets, report
-- cards, analytics) naturally leaves them out.
CREATE OR REPLACE FUNCTION get_score_fields(p_student_id UUID, p_subject_id UUID, p_term_id UUID)
RETURNS TABLE(field_id UUID, field_name TEXT, field_type score_field_type, compute_operation score_compute_operation, order_index INTEGER,
              show_on_report_card BOOLEAN, show_on_score_entry BOOLEAN, is_total_field BOOLEAN, value NUMERIC, max_value NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE v_school_id UUID; v_class UUID;
BEGIN
  SELECT school_id INTO v_school_id FROM students WHERE id = p_student_id;
  IF v_school_id IS NULL THEN RAISE EXCEPTION 'get_score_fields: student not found'; END IF;
  IF NOT COALESCE((is_super_admin() OR (current_school_id() = v_school_id AND current_user_role() = 'school_admin')), FALSE) THEN
    RAISE EXCEPTION 'get_score_fields: not authorized for this student''s school';
  END IF;
  v_class := class_for_student_term(p_student_id, p_term_id);
  IF v_class IS NOT NULL AND NOT student_takes_subject(p_student_id, p_subject_id, v_class) THEN
    RETURN;  -- the student does not take this subject
  END IF;
  RETURN QUERY SELECT * FROM resolve_score_fields(v_school_id, p_student_id, p_subject_id, p_term_id, layout_for_student_term(p_student_id, p_term_id));
END;
$function$;

CREATE OR REPLACE FUNCTION get_class_subject_term_results(p_class_id UUID, p_subject_id UUID, p_term_id UUID)
RETURNS TABLE(student_id UUID, field_id UUID, field_name TEXT, field_type score_field_type, compute_operation score_compute_operation, order_index INTEGER,
              show_on_report_card BOOLEAN, show_on_score_entry BOOLEAN, is_total_field BOOLEAN, value NUMERIC, max_value NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
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
  WHERE student_takes_subject(r.student_id, p_subject_id, p_class_id)
  ORDER BY r.student_id, rf.order_index;
END;
$function$;

CREATE OR REPLACE FUNCTION get_class_all_fields(p_class_id UUID, p_term_id UUID)
RETURNS TABLE(student_id UUID, subject_id UUID, field_id UUID, field_name TEXT, field_type score_field_type, compute_operation score_compute_operation, order_index INTEGER,
              show_on_report_card BOOLEAN, show_on_score_entry BOOLEAN, is_total_field BOOLEAN, value NUMERIC, max_value NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
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
  WHERE student_takes_subject(r.student_id, cs.subject_id, p_class_id)
  ORDER BY r.student_id, cs.subject_id, rf.order_index;
END;
$function$;

CREATE OR REPLACE FUNCTION get_school_term_totals(p_school_id UUID, p_term_id UUID)
RETURNS TABLE(student_id UUID, class_id UUID, subject_id UUID, percentage NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
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
  WHERE rf.is_total_field AND student_takes_subject(p.student_id, p.subject_id, p.class_id);
END;
$function$;

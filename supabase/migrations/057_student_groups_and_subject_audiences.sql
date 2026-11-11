-- 057_student_groups_and_subject_audiences.sql
--
-- STUDENT GROUPS + SUBJECT AUDIENCES.
--
-- Real elective patterns are decided by what KIND of student you are, not by
-- ticking boxes one student at a time:
--   * Science students take Technical Drawing; Arts students take Foods & Nutrition
--   * Muslim students take Islamic Studies; Christian students take Christian Studies
-- so every student ends up with the same NUMBER of subjects, and averages never
-- count "empty" subjects a student doesn't take.
--
-- Model
--   student_group_types   a dimension, e.g. "Stream", "Religion"
--   student_groups        values inside a type: Science / Arts / Commercial ...
--   student_group_members which group a student is in, PER SESSION, at most ONE
--                         group per type (a student can't be both Christian and Muslim)
--   subject_offering_groups the AUDIENCE of a subject at a class level. No rows =
--                         everyone takes it. All groups of one audience must be of
--                         the same type (Science OR Science+Commercial, never
--                         Science+Muslim), so "who takes it" is never ambiguous.
--
-- A subject offering is in exactly ONE mode (enforced by set_subject_audience):
--   'everyone'  compulsory
--   'groups'    only students in the listed groups
--   'choice'    students opt in one by one (055's student_optional_subjects)
--
-- student_takes_subject() is THE definition and is extended here, so Score Entry,
-- broadsheets, report cards, analytics and the roster pick the new rule up
-- with no change to any of their code paths.
--
-- Data-safety decisions
--   * A group (or type) that is still used by members or by a subject audience can't
--     be deleted: deleting an audience group would silently turn a restricted subject
--     back into a compulsory one for everyone.
--   * Restricting a subject to groups never deletes scores. Students who already have
--     scores but fall outside the audience are only HIDDEN; the admin is shown how many
--     before confirming (count_students_hidden_by_audience).
--   * A student with no group for a type used by a subject's audience simply doesn't
--     take that subject; the app flags those students so nobody is silently missed.
--
-- NEW-SUPABASE-GRANTS RULE: every new table has explicit GRANTs below.

-- ───────────────────────── 1. Tables ─────────────────────────
CREATE TABLE student_group_types (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id  UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (school_id, name)
);

CREATE TABLE student_groups (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id  UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  type_id    UUID NOT NULL REFERENCES student_group_types(id) ON DELETE RESTRICT,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (type_id, name)
);
CREATE INDEX idx_student_groups_school ON student_groups(school_id);

CREATE TABLE student_group_members (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id  UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  type_id    UUID NOT NULL REFERENCES student_group_types(id) ON DELETE RESTRICT,
  group_id   UUID NOT NULL REFERENCES student_groups(id) ON DELETE RESTRICT,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, session_id, type_id)           -- one group per type per session
);
CREATE INDEX idx_sgm_school  ON student_group_members(school_id);
CREATE INDEX idx_sgm_session ON student_group_members(session_id);
CREATE INDEX idx_sgm_group   ON student_group_members(group_id);

CREATE TABLE subject_offering_groups (
  offering_id UUID NOT NULL REFERENCES subject_offerings(id) ON DELETE CASCADE,
  group_id    UUID NOT NULL REFERENCES student_groups(id) ON DELETE RESTRICT,
  school_id   UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  PRIMARY KEY (offering_id, group_id)
);
CREATE INDEX idx_sog_group ON subject_offering_groups(group_id);

ALTER TABLE student_group_types   ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE subject_offering_groups ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_group_types     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_groups          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_group_members   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subject_offering_groups TO authenticated;
GRANT ALL ON public.student_group_types     TO service_role;
GRANT ALL ON public.student_groups          TO service_role;
GRANT ALL ON public.student_group_members   TO service_role;
GRANT ALL ON public.subject_offering_groups TO service_role;

-- ───────────────────────── 2. Integrity triggers ─────────────────────────
CREATE OR REPLACE FUNCTION check_student_group()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM student_group_types WHERE id = NEW.type_id AND school_id = NEW.school_id) THEN
    RAISE EXCEPTION 'student_groups: group type belongs to a different school';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_check_student_group BEFORE INSERT OR UPDATE ON student_groups
  FOR EACH ROW EXECUTE FUNCTION check_student_group();

CREATE OR REPLACE FUNCTION check_student_group_member()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM student_groups WHERE id = NEW.group_id AND type_id = NEW.type_id AND school_id = NEW.school_id) THEN
    RAISE EXCEPTION 'student_group_members: the group does not belong to that type / school';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM students WHERE id = NEW.student_id AND school_id = NEW.school_id)
     OR NOT EXISTS (SELECT 1 FROM sessions WHERE id = NEW.session_id AND school_id = NEW.school_id) THEN
    RAISE EXCEPTION 'student_group_members: student and session must belong to the same school';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM student_enrollments WHERE student_id = NEW.student_id AND session_id = NEW.session_id) THEN
    RAISE EXCEPTION 'student_group_members: the student is not enrolled in a class in that session';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_check_student_group_member BEFORE INSERT OR UPDATE ON student_group_members
  FOR EACH ROW EXECUTE FUNCTION check_student_group_member();

-- All groups in one audience share a type; and belong to the offering's school
CREATE OR REPLACE FUNCTION check_subject_offering_group()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_type UUID; v_other_type UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM subject_offerings WHERE id = NEW.offering_id AND school_id = NEW.school_id) THEN
    RAISE EXCEPTION 'subject_offering_groups: offering belongs to a different school';
  END IF;
  SELECT type_id INTO v_type FROM student_groups WHERE id = NEW.group_id AND school_id = NEW.school_id;
  IF v_type IS NULL THEN RAISE EXCEPTION 'subject_offering_groups: group not found in this school'; END IF;
  SELECT g.type_id INTO v_other_type
  FROM subject_offering_groups sog JOIN student_groups g ON g.id = sog.group_id
  WHERE sog.offering_id = NEW.offering_id AND sog.group_id <> NEW.group_id LIMIT 1;
  IF v_other_type IS NOT NULL AND v_other_type <> v_type THEN
    RAISE EXCEPTION 'subject_offering_groups: all groups for one subject must be of the same type (e.g. only streams, or only religions)';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_check_subject_offering_group BEFORE INSERT OR UPDATE ON subject_offering_groups
  FOR EACH ROW EXECUTE FUNCTION check_subject_offering_group();

-- ───────────────────────── 3. RLS ─────────────────────────
CREATE POLICY super_admin_sgt ON student_group_types FOR ALL USING (is_super_admin());
CREATE POLICY read_sgt  ON student_group_types FOR SELECT USING (school_id = current_school_id());
CREATE POLICY admin_ins_sgt ON student_group_types FOR INSERT WITH CHECK (school_id = current_school_id() AND current_user_role() = 'school_admin');
CREATE POLICY admin_upd_sgt ON student_group_types FOR UPDATE USING (school_id = current_school_id() AND current_user_role() = 'school_admin') WITH CHECK (school_id = current_school_id() AND current_user_role() = 'school_admin');
CREATE POLICY admin_del_sgt ON student_group_types FOR DELETE USING (school_id = current_school_id() AND current_user_role() = 'school_admin');

CREATE POLICY super_admin_sg ON student_groups FOR ALL USING (is_super_admin());
CREATE POLICY read_sg  ON student_groups FOR SELECT USING (school_id = current_school_id());
CREATE POLICY admin_ins_sg ON student_groups FOR INSERT WITH CHECK (school_id = current_school_id() AND current_user_role() = 'school_admin');
CREATE POLICY admin_upd_sg ON student_groups FOR UPDATE USING (school_id = current_school_id() AND current_user_role() = 'school_admin') WITH CHECK (school_id = current_school_id() AND current_user_role() = 'school_admin');
CREATE POLICY admin_del_sg ON student_groups FOR DELETE USING (school_id = current_school_id() AND current_user_role() = 'school_admin');

-- Who may place a student in a group: same people who may set electives
-- (school admin, or a section admin holding "enroll students" for that class's section)
CREATE POLICY super_admin_sgm ON student_group_members FOR ALL USING (is_super_admin());
CREATE POLICY read_sgm ON student_group_members FOR SELECT USING (school_id = current_school_id());
CREATE POLICY manager_ins_sgm ON student_group_members FOR INSERT
  WITH CHECK (school_id = current_school_id() AND can_manage_student_electives(student_id, session_id));
CREATE POLICY manager_upd_sgm ON student_group_members FOR UPDATE
  USING (school_id = current_school_id() AND can_manage_student_electives(student_id, session_id))
  WITH CHECK (school_id = current_school_id() AND can_manage_student_electives(student_id, session_id));
CREATE POLICY manager_del_sgm ON student_group_members FOR DELETE
  USING (school_id = current_school_id() AND can_manage_student_electives(student_id, session_id));

CREATE POLICY super_admin_sog ON subject_offering_groups FOR ALL USING (is_super_admin());
CREATE POLICY read_sog ON subject_offering_groups FOR SELECT USING (school_id = current_school_id());
CREATE POLICY admin_ins_sog ON subject_offering_groups FOR INSERT WITH CHECK (school_id = current_school_id() AND current_user_role() = 'school_admin');
CREATE POLICY admin_del_sog ON subject_offering_groups FOR DELETE USING (school_id = current_school_id() AND current_user_role() = 'school_admin');

-- ───────────────────────── 4. THE definition of "takes this subject" (extended) ─────────────────────────
-- Takes it  =  (no offering row at all -> compulsory/legacy)
--          OR  the offering exists AND
--                (not individually-optional OR the student opted in for the session) AND
--                (no audience groups OR the student is in one of them for the session)
CREATE OR REPLACE FUNCTION student_takes_subject(p_student_id UUID, p_subject_id UUID, p_class_id UUID)
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

-- ───────────────────────── 5. RPCs ─────────────────────────
-- How many students who ALREADY HAVE SCORES in this subject (at this level) would stop
-- taking it if it were restricted to these groups? Shown to the admin before confirming.
CREATE OR REPLACE FUNCTION count_students_hidden_by_audience(p_subject_id UUID, p_class_level_id UUID, p_group_ids UUID[])
RETURNS INTEGER LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_school UUID; v_n INTEGER;
BEGIN
  SELECT school_id INTO v_school FROM subject_offerings WHERE subject_id = p_subject_id AND class_level_id = p_class_level_id;
  IF v_school IS NULL THEN RAISE EXCEPTION 'count_students_hidden_by_audience: not offered at that level'; END IF;
  IF NOT COALESCE(is_super_admin() OR (current_school_id() = v_school AND current_user_role() = 'school_admin'), FALSE) THEN
    RAISE EXCEPTION 'count_students_hidden_by_audience: only a school admin can do this';
  END IF;
  SELECT count(DISTINCT ss.student_id) INTO v_n
  FROM student_scores ss JOIN classes c ON c.id = ss.class_id
  WHERE ss.subject_id = p_subject_id AND c.class_level_id = p_class_level_id AND ss.school_id = v_school
    AND NOT EXISTS (
      SELECT 1 FROM student_group_members m
      WHERE m.student_id = ss.student_id AND m.session_id = c.session_id AND m.group_id = ANY(p_group_ids));
  RETURN v_n;
END $$;

-- Set a subject's audience at a class level. School admin only.
--   p_mode 'everyone' | 'groups' (needs p_group_ids) | 'choice'
-- Returns, for 'choice', how many students with existing scores were auto-enrolled;
-- for 'groups', how many students with existing scores are now outside the audience (hidden, not deleted).
CREATE OR REPLACE FUNCTION set_subject_audience(p_subject_id UUID, p_class_level_id UUID, p_mode TEXT, p_group_ids UUID[] DEFAULT '{}')
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
      AND NOT student_takes_subject(ss.student_id, p_subject_id, ss.class_id);
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
END $$;

-- Put ONE student in (or take out of) a group for a session.  p_group_id NULL = no group of that type.
CREATE OR REPLACE FUNCTION set_student_group(p_student_id UUID, p_session_id UUID, p_type_id UUID, p_group_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_school UUID; v_profile UUID;
BEGIN
  SELECT school_id INTO v_school FROM students WHERE id = p_student_id;
  IF v_school IS NULL THEN RAISE EXCEPTION 'set_student_group: student not found'; END IF;
  IF NOT COALESCE(can_manage_student_electives(p_student_id, p_session_id) AND current_school_id() = v_school, FALSE)
     AND NOT COALESCE(is_super_admin(), FALSE) THEN
    RAISE EXCEPTION 'set_student_group: not authorized for this student';
  END IF;
  SELECT id INTO v_profile FROM profiles WHERE user_id = auth.uid();
  IF p_group_id IS NULL THEN
    DELETE FROM student_group_members WHERE student_id = p_student_id AND session_id = p_session_id AND type_id = p_type_id;
  ELSE
    INSERT INTO student_group_members (school_id, student_id, session_id, type_id, group_id, created_by)
    VALUES (v_school, p_student_id, p_session_id, p_type_id, p_group_id, v_profile)
    ON CONFLICT (student_id, session_id, type_id) DO UPDATE SET group_id = EXCLUDED.group_id;
  END IF;
END $$;

-- Bulk: place the given students of a class in a group (or p_group_id NULL = clear that type)
CREATE OR REPLACE FUNCTION set_class_group_members(p_class_id UUID, p_type_id UUID, p_group_id UUID, p_student_ids UUID[])
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_school UUID; v_session UUID; v_profile UUID; v_sid UUID;
BEGIN
  SELECT school_id, session_id INTO v_school, v_session FROM classes WHERE id = p_class_id;
  IF v_school IS NULL THEN RAISE EXCEPTION 'set_class_group_members: class not found'; END IF;
  IF NOT COALESCE(is_super_admin()
      OR (current_school_id() = v_school AND current_user_role() = 'school_admin')
      OR (current_school_id() = v_school AND has_section_permission(p_class_id, 'can_enroll_students')), FALSE) THEN
    RAISE EXCEPTION 'set_class_group_members: not authorized for this class';
  END IF;
  SELECT id INTO v_profile FROM profiles WHERE user_id = auth.uid();
  FOREACH v_sid IN ARRAY p_student_ids LOOP
    IF NOT EXISTS (SELECT 1 FROM student_enrollments WHERE student_id = v_sid AND class_id = p_class_id) THEN CONTINUE; END IF;
    IF p_group_id IS NULL THEN
      DELETE FROM student_group_members WHERE student_id = v_sid AND session_id = v_session AND type_id = p_type_id;
    ELSE
      INSERT INTO student_group_members (school_id, student_id, session_id, type_id, group_id, created_by)
      VALUES (v_school, v_sid, v_session, p_type_id, p_group_id, v_profile)
      ON CONFLICT (student_id, session_id, type_id) DO UPDATE SET group_id = EXCLUDED.group_id;
    END IF;
  END LOOP;
END $$;

-- Promotion helper: carry each student's group (per type) and optional-subject choices into the new class's session.
CREATE OR REPLACE FUNCTION carry_forward_student_choices(p_class_id UUID, p_student_ids UUID[])
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_school UUID; v_session UUID; v_profile UUID; v_groups INTEGER := 0; v_subjects INTEGER := 0;
BEGIN
  SELECT school_id, session_id INTO v_school, v_session FROM classes WHERE id = p_class_id;
  IF v_school IS NULL THEN RAISE EXCEPTION 'carry_forward_student_choices: class not found'; END IF;
  IF NOT COALESCE(is_super_admin() OR (current_school_id() = v_school AND current_user_role() = 'school_admin'), FALSE) THEN
    RAISE EXCEPTION 'carry_forward_student_choices: only a school admin can do this';
  END IF;
  SELECT id INTO v_profile FROM profiles WHERE user_id = auth.uid();

  -- most recent EARLIER membership per (student, type)
  INSERT INTO student_group_members (school_id, student_id, session_id, type_id, group_id, created_by)
  SELECT v_school, x.student_id, v_session, x.type_id, x.group_id, v_profile
  FROM (
    SELECT DISTINCT ON (m.student_id, m.type_id) m.student_id, m.type_id, m.group_id
    FROM student_group_members m
    JOIN sessions s ON s.id = m.session_id
    JOIN sessions cur ON cur.id = v_session
    WHERE m.student_id = ANY(p_student_ids) AND m.session_id <> v_session AND s.start_year < cur.start_year
    ORDER BY m.student_id, m.type_id, s.start_year DESC
  ) x
  WHERE EXISTS (SELECT 1 FROM student_enrollments se WHERE se.student_id = x.student_id AND se.class_id = p_class_id)
  ON CONFLICT (student_id, session_id, type_id) DO NOTHING;
  GET DIAGNOSTICS v_groups = ROW_COUNT;

  v_subjects := carry_forward_optional_subjects(p_class_id, p_student_ids);
  RETURN v_groups + v_subjects;
END $$;

REVOKE EXECUTE ON FUNCTION count_students_hidden_by_audience(UUID, UUID, UUID[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION set_subject_audience(UUID, UUID, TEXT, UUID[])        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION set_student_group(UUID, UUID, UUID, UUID)             FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION set_class_group_members(UUID, UUID, UUID, UUID[])     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION carry_forward_student_choices(UUID, UUID[])           FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION count_students_hidden_by_audience(UUID, UUID, UUID[]) TO authenticated;
GRANT  EXECUTE ON FUNCTION set_subject_audience(UUID, UUID, TEXT, UUID[])        TO authenticated;
GRANT  EXECUTE ON FUNCTION set_student_group(UUID, UUID, UUID, UUID)             TO authenticated;
GRANT  EXECUTE ON FUNCTION set_class_group_members(UUID, UUID, UUID, UUID[])     TO authenticated;
GRANT  EXECUTE ON FUNCTION carry_forward_student_choices(UUID, UUID[])           TO authenticated;
-- student_takes_subject was redefined above: CREATE OR REPLACE keeps its earlier REVOKE (internal only)

-- ============================================================
-- 049: Section Admins (delegated, toggleable permissions)
-- ============================================================
-- A "section admin" is NOT a new role — role stays 'teacher'. It's a
-- teacher who has been granted a row in section_admins for one of
-- their school's school_sections (047), with one or more specific
-- capabilities toggled on. This keeps their nav, dashboard and every
-- existing teacher-only RLS check completely unchanged; the new
-- capabilities are purely additive.
--
-- A teacher can hold grants for multiple sections at once, each with
-- its own independent set of toggles (school_admin_students below is
-- one row per teacher+section, not one row per teacher) — matching
-- "multiple section admins can be set at once with varying functions".
--
-- Scope is deliberately narrow, per spec: add students, enroll
-- students, assign a teacher to a class. NOT included, on purpose:
-- editing/deleting a student, unenrolling, removing an assignment,
-- any document generation/download, and score entry — a section
-- admin has zero more access to any of those than a plain teacher
-- does today.
--
-- Extensibility: adding a 4th toggle later is a new migration that
-- ALTER TABLEs a new boolean column onto section_admins, extends the
-- CASE branch in has_section_permission()/has_school_wide_section_
-- permission() below, and (if it gates a new table) adds one new RLS
-- policy — no redesign of this table or of how existing toggles work.
-- ============================================================

CREATE TABLE section_admins (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id            UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  section_id           UUID NOT NULL REFERENCES school_sections(id) ON DELETE CASCADE,
  teacher_id           UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  can_add_students     BOOLEAN NOT NULL DEFAULT FALSE,
  can_enroll_students  BOOLEAN NOT NULL DEFAULT FALSE,
  can_assign_teachers  BOOLEAN NOT NULL DEFAULT FALSE,
  granted_by           UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(section_id, teacher_id)
);

CREATE INDEX idx_section_admins_school_id  ON section_admins(school_id);
CREATE INDEX idx_section_admins_teacher_id ON section_admins(teacher_id);
CREATE INDEX idx_section_admins_section_id ON section_admins(section_id);

CREATE TRIGGER trg_section_admins_updated_at
  BEFORE UPDATE ON section_admins
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Defence in depth (same pattern as class_levels.section_id in 047,
-- score_field_sources in 041): the teacher and the section must
-- belong to the SAME school as the grant row itself, even though the
-- RLS policies below already scope writes by school. Cross-school
-- grants are impossible even via a direct/service-role write.
CREATE OR REPLACE FUNCTION check_section_admin_same_school()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_teacher_school_id UUID;
  v_section_school_id UUID;
BEGIN
  SELECT school_id INTO v_teacher_school_id FROM profiles WHERE id = NEW.teacher_id;
  SELECT school_id INTO v_section_school_id FROM school_sections WHERE id = NEW.section_id;
  IF v_teacher_school_id IS DISTINCT FROM NEW.school_id OR v_section_school_id IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'Section admin grant must reference a teacher and section in the same school';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_section_admin_same_school
  BEFORE INSERT OR UPDATE ON section_admins
  FOR EACH ROW EXECUTE FUNCTION check_section_admin_same_school();

ALTER TABLE section_admins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_section_admins" ON section_admins
  FOR ALL USING (is_super_admin());

CREATE POLICY "school_admin_manage_section_admins" ON section_admins
  FOR ALL USING (school_id = current_school_id() AND current_user_role() = 'school_admin');

-- A teacher can see their own grants (needed so the teacher-side UI
-- knows which of the 3 actions to show) but can never write to this
-- table themselves — only a school_admin (or super_admin) can.
CREATE POLICY "teacher_read_own_section_admin_grants" ON section_admins
  FOR SELECT USING (teacher_id = (SELECT id FROM profiles WHERE user_id = auth.uid()));

-- ============================================================
-- Helper functions
-- ============================================================

-- Resolves the school_sections.id a given class belongs to, via
-- classes.class_level_id -> class_levels.section_id. Returns NULL for
-- a class whose level has no section assigned (school hasn't opted
-- into sections, or that level simply isn't grouped) — in which case
-- no section-admin grant can ever apply to that class, by design.
CREATE OR REPLACE FUNCTION class_section_id(p_class_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT cl.section_id
  FROM classes c
  JOIN class_levels cl ON cl.id = c.class_level_id
  WHERE c.id = p_class_id;
$$;

-- Class-scoped permission check — does the CURRENT user hold a
-- section_admins grant, for the section that p_class_id belongs to,
-- with p_permission toggled on? Used by student_enrollments and
-- teacher_assignments INSERT policies below, both of which always
-- have a concrete class_id to check against.
--
-- COALESCE(..., FALSE) throughout, per this project's established
-- RLS convention — a bare IF/boolean expression silently passes on
-- SQL NULL, which is exactly the wrong default for an auth check.
CREATE OR REPLACE FUNCTION has_section_permission(p_class_id UUID, p_permission TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_section_id UUID;
  v_profile_id UUID;
  v_ok BOOLEAN;
BEGIN
  v_section_id := class_section_id(p_class_id);
  IF v_section_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT id INTO v_profile_id FROM profiles WHERE user_id = auth.uid();
  IF v_profile_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT CASE p_permission
    WHEN 'can_enroll_students' THEN bool_or(can_enroll_students)
    WHEN 'can_assign_teachers' THEN bool_or(can_assign_teachers)
    ELSE FALSE
  END INTO v_ok
  FROM section_admins
  WHERE teacher_id = v_profile_id AND section_id = v_section_id;

  RETURN COALESCE(v_ok, FALSE);
END;
$$;

-- School-wide permission check — for "add a student", which has no
-- class/section on the row being inserted (a raw student record isn't
-- sectioned until it's later enrolled into a class). This intentionally
-- grants school-wide add-student access to a teacher who holds
-- can_add_students=true for ANY section in the school, rather than
-- trying to scope student creation itself by section — there is no
-- section to scope it by at creation time.
CREATE OR REPLACE FUNCTION has_school_wide_section_permission(p_school_id UUID, p_permission TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_profile_id UUID;
  v_ok BOOLEAN;
BEGIN
  SELECT id INTO v_profile_id FROM profiles WHERE user_id = auth.uid();
  IF v_profile_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT CASE p_permission
    WHEN 'can_add_students' THEN bool_or(can_add_students)
    ELSE FALSE
  END INTO v_ok
  FROM section_admins
  WHERE teacher_id = v_profile_id AND school_id = p_school_id;

  RETURN COALESCE(v_ok, FALSE);
END;
$$;

-- ============================================================
-- Tighten existing RLS so the toggles above actually mean something
-- ============================================================
-- students INSERT and student_enrollments INSERT/UPDATE/DELETE were,
-- since 001/013, open to ANY school member — including a plain
-- teacher with zero grants — purely because nothing in the UI ever
-- exposed those actions to a teacher. Confirmed by inspection: no
-- teacher-facing page performs any of these writes today, so
-- tightening them changes nothing for existing behavior. Left
-- deliberately alone: SELECT on both tables (still any school
-- member — reads were never the concern), and students UPDATE
-- (013's own comment marks that one "unchanged" as a considered
-- decision at the time, and no new permission was requested for it
-- here, so it's out of scope for this migration).

DROP POLICY IF EXISTS "school_member_students_insert" ON students;
CREATE POLICY "school_admin_or_grant_students_insert" ON students
  FOR INSERT WITH CHECK (
    school_id = current_school_id()
    AND (
      current_user_role() = 'school_admin'
      OR has_school_wide_section_permission(school_id, 'can_add_students')
    )
  );

DROP POLICY IF EXISTS "school_member_enrollments" ON student_enrollments;
CREATE POLICY "school_member_enrollments_select" ON student_enrollments
  FOR SELECT USING (school_id = current_school_id());
CREATE POLICY "school_admin_or_grant_enrollments_insert" ON student_enrollments
  FOR INSERT WITH CHECK (
    school_id = current_school_id()
    AND (
      current_user_role() = 'school_admin'
      OR has_section_permission(class_id, 'can_enroll_students')
    )
  );
CREATE POLICY "school_admin_enrollments_update" ON student_enrollments
  FOR UPDATE USING (school_id = current_school_id() AND current_user_role() = 'school_admin');
CREATE POLICY "school_admin_enrollments_delete" ON student_enrollments
  FOR DELETE USING (school_id = current_school_id() AND current_user_role() = 'school_admin');

-- teacher_assignments already had no general teacher-write policy
-- (only school_admin_assignments FOR ALL + teacher_own_assignments
-- SELECT) — this just adds the new, narrowly-scoped INSERT path.
CREATE POLICY "section_admin_assignments_insert" ON teacher_assignments
  FOR INSERT WITH CHECK (
    school_id = current_school_id()
    AND has_section_permission(class_id, 'can_assign_teachers')
  );

GRANT EXECUTE ON FUNCTION class_section_id TO authenticated;
GRANT EXECUTE ON FUNCTION has_section_permission TO authenticated;
GRANT EXECUTE ON FUNCTION has_school_wide_section_permission TO authenticated;

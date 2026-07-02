-- ============================================================
-- CA-WIZARD  |  Migration 001 — Complete Initial Schema
-- Multi-tenant School Assessment Management Platform
-- ============================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE user_role AS ENUM ('super_admin', 'school_admin', 'teacher');
CREATE TYPE school_status AS ENUM ('active', 'suspended', 'pending');
CREATE TYPE term_name AS ENUM ('First Term', 'Second Term', 'Third Term');
CREATE TYPE assignment_scope AS ENUM ('CLASS', 'SUBJECT');
CREATE TYPE gender_type AS ENUM ('Male', 'Female');
CREATE TYPE rating_scale AS ENUM ('5', '4', '3', '2', '1');
CREATE TYPE audit_action AS ENUM (
  'CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT',
  'PUBLISH', 'LOCK', 'UNLOCK', 'PROMOTE', 'SCORE_ENTRY'
);

-- ============================================================
-- SCHOOLS  (one row per tenant)
-- ============================================================

CREATE TABLE schools (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  address         TEXT,
  phone           TEXT,
  email           TEXT,
  logo_url        TEXT,
  motto           TEXT,
  principal_name  TEXT,
  status          school_status NOT NULL DEFAULT 'active',
  subscription_tier TEXT NOT NULL DEFAULT 'free',
  subscription_expires_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- PROFILES  (extends Supabase auth.users)
-- ============================================================

CREATE TABLE profiles (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  school_id     UUID REFERENCES schools(id) ON DELETE CASCADE,
  role          user_role NOT NULL DEFAULT 'teacher',
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  email         TEXT NOT NULL,
  phone         TEXT,
  avatar_url    TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_profiles_user_id    ON profiles(user_id);
CREATE INDEX idx_profiles_school_id  ON profiles(school_id);
CREATE INDEX idx_profiles_role       ON profiles(role);

-- ============================================================
-- INVITE CODES
-- ============================================================

CREATE TABLE invite_codes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id       UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  code            TEXT NOT NULL UNIQUE,
  class_level_id  UUID,                          -- resolved after class_levels table
  class_arm_id    UUID,                          -- resolved after class_arms table
  subject_id      UUID,                          -- resolved after subjects table
  scope           assignment_scope NOT NULL DEFAULT 'CLASS',
  label           TEXT,                          -- human-readable e.g. "JSS1A - Maths"
  created_by      UUID REFERENCES profiles(id),
  used_by         UUID REFERENCES profiles(id),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  used_at         TIMESTAMPTZ,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invite_codes_school_id ON invite_codes(school_id);
CREATE INDEX idx_invite_codes_code      ON invite_codes(code);

-- ============================================================
-- SESSIONS  (e.g. 2025/2026)
-- ============================================================

CREATE TABLE sessions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id   UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,               -- e.g. "2025/2026"
  start_year  INT NOT NULL,
  end_year    INT NOT NULL,
  is_current  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(school_id, name)
);

CREATE INDEX idx_sessions_school_id ON sessions(school_id);

-- Enforce only one current session per school
CREATE UNIQUE INDEX idx_sessions_current ON sessions(school_id) WHERE is_current = TRUE;

-- ============================================================
-- TERMS
-- ============================================================

CREATE TABLE terms (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id       UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  session_id      UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  name            term_name NOT NULL,
  start_date      DATE,
  end_date        DATE,
  is_current      BOOLEAN NOT NULL DEFAULT FALSE,
  is_published    BOOLEAN NOT NULL DEFAULT FALSE,
  is_locked       BOOLEAN NOT NULL DEFAULT FALSE,
  published_at    TIMESTAMPTZ,
  locked_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id, name)
);

CREATE INDEX idx_terms_session_id ON terms(session_id);
CREATE INDEX idx_terms_school_id  ON terms(school_id);
CREATE UNIQUE INDEX idx_terms_current ON terms(school_id) WHERE is_current = TRUE;

-- ============================================================
-- CLASS LEVELS  (JSS1, JSS2, SS1, SS2, Year 7, etc.)
-- ============================================================

CREATE TABLE class_levels (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id     UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,             -- "JSS1", "Year 7", "SS2"
  order_index   INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(school_id, name)
);

CREATE INDEX idx_class_levels_school_id ON class_levels(school_id);

-- ============================================================
-- CLASS ARMS  (A, B, Science, Arts, Gold, etc.)
-- ============================================================

CREATE TABLE class_arms (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id   UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,               -- "A", "B", "Science", "Gold"
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(school_id, name)
);

CREATE INDEX idx_class_arms_school_id ON class_arms(school_id);

-- ============================================================
-- CLASSES  (class_level + class_arm in a session)
-- ============================================================

CREATE TABLE classes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id       UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  session_id      UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  class_level_id  UUID NOT NULL REFERENCES class_levels(id) ON DELETE RESTRICT,
  class_arm_id    UUID NOT NULL REFERENCES class_arms(id) ON DELETE RESTRICT,
  form_teacher_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(session_id, class_level_id, class_arm_id)
);

CREATE INDEX idx_classes_school_id    ON classes(school_id);
CREATE INDEX idx_classes_session_id   ON classes(session_id);
CREATE INDEX idx_classes_level_arm    ON classes(class_level_id, class_arm_id);

-- ============================================================
-- SUBJECTS
-- ============================================================

CREATE TABLE subjects (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id       UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_level_id  UUID NOT NULL REFERENCES class_levels(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  code            TEXT,                    -- "MTH", "ENG"
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(school_id, class_level_id, name)
);

CREATE INDEX idx_subjects_school_id      ON subjects(school_id);
CREATE INDEX idx_subjects_class_level_id ON subjects(class_level_id);

-- ============================================================
-- STUDENTS
-- ============================================================

CREATE TABLE students (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id         UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  admission_number  TEXT NOT NULL,
  first_name        TEXT NOT NULL,
  last_name         TEXT NOT NULL,
  middle_name       TEXT,
  gender            gender_type,
  date_of_birth     DATE,
  photo_url         TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(school_id, admission_number)
);

CREATE INDEX idx_students_school_id ON students(school_id);
CREATE INDEX idx_students_name      ON students USING gin(
  (first_name || ' ' || last_name) gin_trgm_ops
);

-- ============================================================
-- STUDENT-CLASS ENROLLMENT  (student ↔ class per session)
-- ============================================================

CREATE TABLE student_enrollments (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id   UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id  UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id    UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  session_id  UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(student_id, class_id, session_id)
);

CREATE INDEX idx_enrollments_school_id   ON student_enrollments(school_id);
CREATE INDEX idx_enrollments_student_id  ON student_enrollments(student_id);
CREATE INDEX idx_enrollments_class_id    ON student_enrollments(class_id);

-- ============================================================
-- TEACHER ASSIGNMENTS
-- ============================================================

CREATE TABLE teacher_assignments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id       UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  teacher_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  class_id        UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject_id      UUID REFERENCES subjects(id) ON DELETE CASCADE,
  scope           assignment_scope NOT NULL DEFAULT 'SUBJECT',
  invite_code_id  UUID REFERENCES invite_codes(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(teacher_id, class_id, subject_id)
);

CREATE INDEX idx_teacher_assignments_school_id   ON teacher_assignments(school_id);
CREATE INDEX idx_teacher_assignments_teacher_id  ON teacher_assignments(teacher_id);
CREATE INDEX idx_teacher_assignments_class_id    ON teacher_assignments(class_id);

-- ============================================================
-- ASSESSMENT CATEGORIES  (Homework 5, Quiz 10, Classwork 15…)
-- ============================================================

CREATE TABLE assessment_categories (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id     UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  max_score     NUMERIC(5,2) NOT NULL DEFAULT 10,
  order_index   INT NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(school_id, name)
);

CREATE INDEX idx_assessment_categories_school_id ON assessment_categories(school_id);

-- ============================================================
-- GRADING SYSTEMS
-- ============================================================

CREATE TABLE grading_systems (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id   UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT 'Default',
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(school_id, name)
);

CREATE TABLE grade_ranges (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id         UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  grading_system_id UUID NOT NULL REFERENCES grading_systems(id) ON DELETE CASCADE,
  grade             TEXT NOT NULL,           -- "A", "B+", "C"
  min_score         NUMERIC(5,2) NOT NULL,
  max_score         NUMERIC(5,2) NOT NULL,
  remark            TEXT,                    -- "Excellent", "Good"
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_grade_ranges_system_id ON grade_ranges(grading_system_id);

-- ============================================================
-- STUDENT SCORES  (raw CA component scores)
-- ============================================================

CREATE TABLE student_scores (
  id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id                 UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id                UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id                  UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject_id                UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  term_id                   UUID NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  assessment_category_id    UUID NOT NULL REFERENCES assessment_categories(id) ON DELETE CASCADE,
  score                     NUMERIC(5,2),
  entered_by                UUID REFERENCES profiles(id) ON DELETE SET NULL,
  is_synced                 BOOLEAN NOT NULL DEFAULT TRUE,   -- FALSE when entered offline
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(student_id, subject_id, term_id, assessment_category_id)
);

CREATE INDEX idx_student_scores_school_id   ON student_scores(school_id);
CREATE INDEX idx_student_scores_student_id  ON student_scores(student_id);
CREATE INDEX idx_student_scores_term_id     ON student_scores(term_id);
CREATE INDEX idx_student_scores_subject_id  ON student_scores(subject_id);
CREATE INDEX idx_student_scores_class_id    ON student_scores(class_id);

-- ============================================================
-- EXAM SCORES  (terminal exam, entered separately)
-- ============================================================

CREATE TABLE exam_scores (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id   UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id  UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id    UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject_id  UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  term_id     UUID NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  score       NUMERIC(5,2),
  max_score   NUMERIC(5,2) NOT NULL DEFAULT 60,
  entered_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  is_synced   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(student_id, subject_id, term_id)
);

CREATE INDEX idx_exam_scores_school_id  ON exam_scores(school_id);
CREATE INDEX idx_exam_scores_term_id    ON exam_scores(term_id);
CREATE INDEX idx_exam_scores_student_id ON exam_scores(student_id);

-- ============================================================
-- COMPUTED VIEW — CA Broadsheet
-- (Pre-CA total per student per subject per term)
-- ============================================================

CREATE OR REPLACE VIEW v_ca_broadsheet AS
SELECT
  ss.school_id,
  ss.student_id,
  ss.class_id,
  ss.subject_id,
  ss.term_id,
  ROUND(SUM(ss.score), 2)                    AS ca_total,
  ROUND(SUM(ac.max_score), 2)                AS ca_max,
  COUNT(ss.id)                                AS categories_entered
FROM student_scores ss
JOIN assessment_categories ac ON ac.id = ss.assessment_category_id
GROUP BY ss.school_id, ss.student_id, ss.class_id, ss.subject_id, ss.term_id;

-- ============================================================
-- COMPUTED VIEW — Term Results
-- (CA + Exam → Total → Grade → Position)
-- ============================================================

CREATE OR REPLACE VIEW v_term_results AS
SELECT
  ca.school_id,
  ca.student_id,
  ca.class_id,
  ca.subject_id,
  ca.term_id,
  ca.ca_total,
  ca.ca_max,
  COALESCE(es.score, 0)                       AS exam_score,
  COALESCE(es.max_score, 60)                  AS exam_max,
  ROUND(ca.ca_total + COALESCE(es.score, 0), 2) AS term_total,
  ROUND(
    (ca.ca_total / NULLIF(ca.ca_max, 0)) * 40 +
    (COALESCE(es.score, 0) / NULLIF(COALESCE(es.max_score, 60), 0)) * 60
  , 2)                                        AS term_percentage
FROM v_ca_broadsheet ca
LEFT JOIN exam_scores es
  ON es.student_id = ca.student_id
  AND es.subject_id = ca.subject_id
  AND es.term_id = ca.term_id;

-- ============================================================
-- ATTENDANCE
-- ============================================================

CREATE TABLE attendance (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id     UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id    UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  class_id      UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  term_id       UUID NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  days_present  INT NOT NULL DEFAULT 0,
  days_absent   INT NOT NULL DEFAULT 0,
  total_days    INT GENERATED ALWAYS AS (days_present + days_absent) STORED,
  entered_by    UUID REFERENCES profiles(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(student_id, term_id)
);

CREATE INDEX idx_attendance_school_id  ON attendance(school_id);
CREATE INDEX idx_attendance_student_id ON attendance(student_id);
CREATE INDEX idx_attendance_term_id    ON attendance(term_id);

-- ============================================================
-- AFFECTIVE & PSYCHOMOTOR METRICS
-- ============================================================

CREATE TABLE affective_metrics (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id   UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,             -- "Punctuality", "Honesty"
  order_index INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(school_id, name)
);

CREATE TABLE psychomotor_metrics (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id   UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,             -- "Neatness", "Leadership"
  order_index INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(school_id, name)
);

CREATE TABLE affective_scores (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id   UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id  UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  metric_id   UUID NOT NULL REFERENCES affective_metrics(id) ON DELETE CASCADE,
  term_id     UUID NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  class_id    UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  rating      rating_scale NOT NULL DEFAULT '3',
  entered_by  UUID REFERENCES profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(student_id, metric_id, term_id)
);

CREATE TABLE psychomotor_scores (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id   UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id  UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  metric_id   UUID NOT NULL REFERENCES psychomotor_metrics(id) ON DELETE CASCADE,
  term_id     UUID NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  class_id    UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  rating      rating_scale NOT NULL DEFAULT '3',
  entered_by  UUID REFERENCES profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(student_id, metric_id, term_id)
);

-- ============================================================
-- COMMENTS
-- ============================================================

CREATE TABLE comments (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id           UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id          UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  term_id             UUID NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  class_id            UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  teacher_comment     TEXT,
  management_comment  TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(student_id, term_id)
);

-- ============================================================
-- REPORT SNAPSHOTS  (immutable once published)
-- ============================================================

CREATE TABLE report_snapshots (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id     UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id    UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  term_id       UUID NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  class_id      UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  snapshot_data JSONB NOT NULL,           -- full report card payload
  pdf_url       TEXT,
  generated_by  UUID REFERENCES profiles(id),
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(student_id, term_id)
);

CREATE INDEX idx_report_snapshots_school_id   ON report_snapshots(school_id);
CREATE INDEX idx_report_snapshots_student_id  ON report_snapshots(student_id);
CREATE INDEX idx_report_snapshots_term_id     ON report_snapshots(term_id);

-- ============================================================
-- AUDIT LOGS
-- ============================================================

CREATE TABLE audit_logs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id     UUID REFERENCES schools(id) ON DELETE SET NULL,
  user_id       UUID REFERENCES profiles(id) ON DELETE SET NULL,
  action        audit_action NOT NULL,
  entity_type   TEXT NOT NULL,           -- "student_score", "term", "student"
  entity_id     UUID,
  old_value     JSONB,
  new_value     JSONB,
  ip_address    INET,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_school_id ON audit_logs(school_id);
CREATE INDEX idx_audit_logs_user_id   ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created   ON audit_logs(created_at DESC);

-- ============================================================
-- FOREIGN KEY DEFERRED RESOLUTIONS (invite_codes)
-- ============================================================

ALTER TABLE invite_codes
  ADD CONSTRAINT fk_invite_class_level
    FOREIGN KEY (class_level_id) REFERENCES class_levels(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_invite_class_arm
    FOREIGN KEY (class_arm_id) REFERENCES class_arms(id) ON DELETE SET NULL,
  ADD CONSTRAINT fk_invite_subject
    FOREIGN KEY (subject_id) REFERENCES subjects(id) ON DELETE SET NULL;

-- ============================================================
-- UPDATED_AT TRIGGER FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables with updated_at
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'schools','profiles','sessions','terms',
    'students','student_scores','exam_scores',
    'attendance','comments'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%s_updated_at
       BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()',
      t, t
    );
  END LOOP;
END;
$$;

-- ============================================================
-- AUTO-CREATE PROFILE ON AUTH SIGN-UP
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (user_id, email, first_name, last_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'first_name', 'User'),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'teacher')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE schools            ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE invite_codes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE terms              ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_levels       ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_arms         ENABLE ROW LEVEL SECURITY;
ALTER TABLE classes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE subjects           ENABLE ROW LEVEL SECURITY;
ALTER TABLE students           ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE grading_systems    ENABLE ROW LEVEL SECURITY;
ALTER TABLE grade_ranges       ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_scores     ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_scores        ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance         ENABLE ROW LEVEL SECURITY;
ALTER TABLE affective_metrics  ENABLE ROW LEVEL SECURITY;
ALTER TABLE psychomotor_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE affective_scores   ENABLE ROW LEVEL SECURITY;
ALTER TABLE psychomotor_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_snapshots   ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs         ENABLE ROW LEVEL SECURITY;

-- Helper function: get current user's profile
CREATE OR REPLACE FUNCTION current_user_profile()
RETURNS profiles AS $$
  SELECT * FROM profiles WHERE user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper function: get current user's role
CREATE OR REPLACE FUNCTION current_user_role()
RETURNS user_role AS $$
  SELECT role FROM profiles WHERE user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper function: get current user's school_id
CREATE OR REPLACE FUNCTION current_school_id()
RETURNS UUID AS $$
  SELECT school_id FROM profiles WHERE user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper function: is super admin
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS(
    SELECT 1 FROM profiles
    WHERE user_id = auth.uid() AND role = 'super_admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper function: is school admin for given school
CREATE OR REPLACE FUNCTION is_school_admin(p_school_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS(
    SELECT 1 FROM profiles
    WHERE user_id = auth.uid()
      AND school_id = p_school_id
      AND role = 'school_admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper function: teacher can access class
CREATE OR REPLACE FUNCTION teacher_has_class_access(p_class_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS(
    SELECT 1 FROM teacher_assignments ta
    JOIN profiles p ON p.id = ta.teacher_id
    WHERE p.user_id = auth.uid()
      AND ta.class_id = p_class_id
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ---- SCHOOLS RLS ----

CREATE POLICY "super_admin_all_schools" ON schools
  FOR ALL USING (is_super_admin());

CREATE POLICY "school_admin_own_school" ON schools
  FOR SELECT USING (id = current_school_id());

CREATE POLICY "teacher_own_school" ON schools
  FOR SELECT USING (id = current_school_id());

-- ---- PROFILES RLS ----

CREATE POLICY "super_admin_all_profiles" ON profiles
  FOR ALL USING (is_super_admin());

CREATE POLICY "own_profile" ON profiles
  FOR ALL USING (user_id = auth.uid());

CREATE POLICY "school_admin_school_profiles" ON profiles
  FOR SELECT USING (school_id = current_school_id() AND current_user_role() = 'school_admin');

CREATE POLICY "teacher_same_school_profiles" ON profiles
  FOR SELECT USING (school_id = current_school_id() AND current_user_role() = 'teacher');

-- ---- SESSIONS, TERMS, CLASS_LEVELS, CLASS_ARMS, SUBJECTS RLS ----
-- Pattern: super_admin sees all, school members see their school's data

CREATE POLICY "super_admin_sessions" ON sessions FOR ALL USING (is_super_admin());
CREATE POLICY "school_member_sessions" ON sessions FOR ALL USING (school_id = current_school_id());

CREATE POLICY "super_admin_terms" ON terms FOR ALL USING (is_super_admin());
CREATE POLICY "school_member_terms" ON terms FOR ALL USING (school_id = current_school_id());

CREATE POLICY "super_admin_class_levels" ON class_levels FOR ALL USING (is_super_admin());
CREATE POLICY "school_member_class_levels" ON class_levels FOR ALL USING (school_id = current_school_id());

CREATE POLICY "super_admin_class_arms" ON class_arms FOR ALL USING (is_super_admin());
CREATE POLICY "school_member_class_arms" ON class_arms FOR ALL USING (school_id = current_school_id());

CREATE POLICY "super_admin_classes" ON classes FOR ALL USING (is_super_admin());
CREATE POLICY "school_member_classes" ON classes FOR ALL USING (school_id = current_school_id());

CREATE POLICY "super_admin_subjects" ON subjects FOR ALL USING (is_super_admin());
CREATE POLICY "school_member_subjects" ON subjects FOR ALL USING (school_id = current_school_id());

-- ---- STUDENTS RLS ----

CREATE POLICY "super_admin_students" ON students FOR ALL USING (is_super_admin());
CREATE POLICY "school_member_students" ON students FOR ALL USING (school_id = current_school_id());

-- ---- STUDENT ENROLLMENTS RLS ----

CREATE POLICY "super_admin_enrollments" ON student_enrollments FOR ALL USING (is_super_admin());
CREATE POLICY "school_member_enrollments" ON student_enrollments FOR ALL USING (school_id = current_school_id());

-- ---- TEACHER ASSIGNMENTS RLS ----

CREATE POLICY "super_admin_assignments" ON teacher_assignments FOR ALL USING (is_super_admin());
CREATE POLICY "school_admin_assignments" ON teacher_assignments FOR ALL
  USING (school_id = current_school_id() AND current_user_role() = 'school_admin');
CREATE POLICY "teacher_own_assignments" ON teacher_assignments FOR SELECT
  USING (teacher_id = (SELECT id FROM profiles WHERE user_id = auth.uid()));

-- ---- INVITE CODES RLS ----

CREATE POLICY "super_admin_invite_codes" ON invite_codes FOR ALL USING (is_super_admin());
CREATE POLICY "school_admin_invite_codes" ON invite_codes FOR ALL
  USING (school_id = current_school_id() AND current_user_role() = 'school_admin');
CREATE POLICY "public_read_invite_code" ON invite_codes FOR SELECT USING (TRUE);

-- ---- ASSESSMENT CATEGORIES, GRADING SYSTEMS, GRADE RANGES ----

CREATE POLICY "super_admin_assessment_cat" ON assessment_categories FOR ALL USING (is_super_admin());
CREATE POLICY "school_member_assessment_cat" ON assessment_categories FOR ALL USING (school_id = current_school_id());

CREATE POLICY "super_admin_grading" ON grading_systems FOR ALL USING (is_super_admin());
CREATE POLICY "school_member_grading" ON grading_systems FOR ALL USING (school_id = current_school_id());

CREATE POLICY "super_admin_grade_ranges" ON grade_ranges FOR ALL USING (is_super_admin());
CREATE POLICY "school_member_grade_ranges" ON grade_ranges FOR ALL USING (school_id = current_school_id());

-- ---- STUDENT SCORES RLS ----

CREATE POLICY "super_admin_scores" ON student_scores FOR ALL USING (is_super_admin());
CREATE POLICY "school_admin_scores" ON student_scores FOR ALL
  USING (school_id = current_school_id() AND current_user_role() = 'school_admin');
CREATE POLICY "teacher_scores_assigned" ON student_scores FOR ALL
  USING (
    school_id = current_school_id()
    AND current_user_role() = 'teacher'
    AND teacher_has_class_access(class_id)
    AND NOT EXISTS (
      SELECT 1 FROM terms t WHERE t.id = term_id AND t.is_locked = TRUE
    )
  );

-- ---- EXAM SCORES RLS ----

CREATE POLICY "super_admin_exam_scores" ON exam_scores FOR ALL USING (is_super_admin());
CREATE POLICY "school_admin_exam_scores" ON exam_scores FOR ALL
  USING (school_id = current_school_id() AND current_user_role() = 'school_admin');
CREATE POLICY "teacher_exam_scores" ON exam_scores FOR ALL
  USING (
    school_id = current_school_id()
    AND current_user_role() = 'teacher'
    AND teacher_has_class_access(class_id)
    AND NOT EXISTS (
      SELECT 1 FROM terms t WHERE t.id = term_id AND t.is_locked = TRUE
    )
  );

-- ---- ATTENDANCE ----

CREATE POLICY "super_admin_attendance" ON attendance FOR ALL USING (is_super_admin());
CREATE POLICY "school_member_attendance" ON attendance FOR ALL USING (school_id = current_school_id());

-- ---- AFFECTIVE / PSYCHOMOTOR ----

CREATE POLICY "super_admin_affective" ON affective_metrics FOR ALL USING (is_super_admin());
CREATE POLICY "school_member_affective" ON affective_metrics FOR ALL USING (school_id = current_school_id());

CREATE POLICY "super_admin_psychomotor" ON psychomotor_metrics FOR ALL USING (is_super_admin());
CREATE POLICY "school_member_psychomotor" ON psychomotor_metrics FOR ALL USING (school_id = current_school_id());

CREATE POLICY "super_admin_affective_scores" ON affective_scores FOR ALL USING (is_super_admin());
CREATE POLICY "school_member_affective_scores" ON affective_scores FOR ALL USING (school_id = current_school_id());

CREATE POLICY "super_admin_psychomotor_scores" ON psychomotor_scores FOR ALL USING (is_super_admin());
CREATE POLICY "school_member_psychomotor_scores" ON psychomotor_scores FOR ALL USING (school_id = current_school_id());

-- ---- COMMENTS ----

CREATE POLICY "super_admin_comments" ON comments FOR ALL USING (is_super_admin());
CREATE POLICY "school_member_comments" ON comments FOR ALL USING (school_id = current_school_id());

-- ---- REPORT SNAPSHOTS ----

CREATE POLICY "super_admin_snapshots" ON report_snapshots FOR ALL USING (is_super_admin());
CREATE POLICY "school_member_snapshots" ON report_snapshots FOR ALL USING (school_id = current_school_id());

-- ---- AUDIT LOGS ----

CREATE POLICY "super_admin_audit" ON audit_logs FOR ALL USING (is_super_admin());
CREATE POLICY "school_admin_audit_read" ON audit_logs FOR SELECT
  USING (school_id = current_school_id() AND current_user_role() = 'school_admin');

-- ============================================================
-- SEED DATA
-- ============================================================

-- NOTE: Super Admin user is created via Supabase Dashboard or CLI.
-- After creating the auth user, run this to assign super_admin role:
--
-- UPDATE profiles SET role = 'super_admin', school_id = NULL
-- WHERE email = 'your-superadmin@email.com';
--
-- The seed below creates a demo school and its structure.

-- Demo School
INSERT INTO schools (id, name, slug, address, phone, email, motto, principal_name, status)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'Mirror International School',
  'mirror-international',
  'Trans-Amadi, Port Harcourt, Rivers State',
  '+234-800-000-0001',
  'admin@mirrorinternational.edu.ng',
  'Excellence Through Knowledge',
  'Mr. Uchenna Okafor',
  'active'
);

-- Demo Session
INSERT INTO sessions (id, school_id, name, start_year, end_year, is_current)
VALUES (
  'b0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  '2025/2026', 2025, 2026, TRUE
);

-- Demo Terms
INSERT INTO terms (id, school_id, session_id, name, is_current)
VALUES
  ('c0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-000000000001',
   'First Term', TRUE),
  ('c0000000-0000-0000-0000-000000000002',
   'a0000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-000000000001',
   'Second Term', FALSE),
  ('c0000000-0000-0000-0000-000000000003',
   'a0000000-0000-0000-0000-000000000001',
   'b0000000-0000-0000-0000-000000000001',
   'Third Term', FALSE);

-- Demo Class Levels (Mirror HS uses Year 7–12)
INSERT INTO class_levels (id, school_id, name, order_index)
VALUES
  ('d0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Year 7',  1),
  ('d0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'Year 8',  2),
  ('d0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'Year 9',  3),
  ('d0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'Year 10', 4),
  ('d0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'Year 11', 5),
  ('d0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 'Year 12', 6);

-- Demo Class Arms
INSERT INTO class_arms (id, school_id, name)
VALUES
  ('e0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'A'),
  ('e0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'B'),
  ('e0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'Science'),
  ('e0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'Arts'),
  ('e0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'Commercial');

-- Demo Assessment Categories
INSERT INTO assessment_categories (school_id, name, max_score, order_index)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Classwork',  15, 1),
  ('a0000000-0000-0000-0000-000000000001', 'Homework',    5, 2),
  ('a0000000-0000-0000-0000-000000000001', 'Quiz',       10, 3),
  ('a0000000-0000-0000-0000-000000000001', 'Assignment', 10, 4);

-- Demo Grading System
INSERT INTO grading_systems (id, school_id, name, is_default)
VALUES ('f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Standard', TRUE);

INSERT INTO grade_ranges (school_id, grading_system_id, grade, min_score, max_score, remark)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'A',  75, 100, 'Excellent'),
  ('a0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'B',  65,  74, 'Very Good'),
  ('a0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'C',  55,  64, 'Good'),
  ('a0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'D',  45,  54, 'Fair'),
  ('a0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'E',  40,  44, 'Pass'),
  ('a0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'F',   0,  39, 'Fail');

-- Demo Subjects (Year 7)
INSERT INTO subjects (school_id, class_level_id, name, code)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Mathematics',             'MTH'),
  ('a0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'English Language',        'ENG'),
  ('a0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Physics',                 'PHY'),
  ('a0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Chemistry',               'CHE'),
  ('a0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Biology',                 'BIO'),
  ('a0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Information Technology',  'IT'),
  ('a0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Cultural & Creative Arts','CCA'),
  ('a0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Religious Studies',       'RST'),
  ('a0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Physical & Health Ed.',   'PHE');

-- Demo Affective Metrics
INSERT INTO affective_metrics (school_id, name, order_index)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Punctuality',    1),
  ('a0000000-0000-0000-0000-000000000001', 'Honesty',        2),
  ('a0000000-0000-0000-0000-000000000001', 'Cooperation',    3),
  ('a0000000-0000-0000-0000-000000000001', 'Perseverance',   4),
  ('a0000000-0000-0000-0000-000000000001', 'Respect',        5);

-- Demo Psychomotor Metrics
INSERT INTO psychomotor_metrics (school_id, name, order_index)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Neatness',       1),
  ('a0000000-0000-0000-0000-000000000001', 'Leadership',     2),
  ('a0000000-0000-0000-0000-000000000001', 'Sportsmanship',  3),
  ('a0000000-0000-0000-0000-000000000001', 'Creativity',     4),
  ('a0000000-0000-0000-0000-000000000001', 'Handwriting',    5);

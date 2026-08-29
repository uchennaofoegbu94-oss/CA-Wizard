-- ============================================================
-- CA-WIZARD | Migration 006 — Global subject catalog +
--                              simplified invite codes
-- ============================================================

-- ── Global Subject Catalog ──────────────────────────────────
-- Subjects used to be created once PER class level (re-typing
-- "Mathematics" for every level). They're now a school-wide
-- catalog; which levels actually offer a subject is a separate
-- many-to-many relationship below.

ALTER TABLE subjects ALTER COLUMN class_level_id DROP NOT NULL;

-- Subjects can repeat by name now that they're not level-scoped —
-- the old UNIQUE(school_id, class_level_id, name) no longer makes
-- sense as the identity constraint. Replace with a school-wide
-- name uniqueness instead.
ALTER TABLE subjects DROP CONSTRAINT IF EXISTS subjects_school_id_class_level_id_name_key;
ALTER TABLE subjects ADD CONSTRAINT subjects_school_id_name_key UNIQUE (school_id, name);

CREATE TABLE subject_offerings (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id       UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  subject_id      UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  class_level_id  UUID NOT NULL REFERENCES class_levels(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(subject_id, class_level_id)
);

CREATE INDEX idx_subject_offerings_school_id ON subject_offerings(school_id);
CREATE INDEX idx_subject_offerings_level_id ON subject_offerings(class_level_id);

-- Backfill: every existing subject row already implies "this
-- subject is offered at this level" — carry that forward so no
-- existing data is lost.
INSERT INTO subject_offerings (school_id, subject_id, class_level_id)
SELECT school_id, id, class_level_id
FROM subjects
WHERE class_level_id IS NOT NULL
ON CONFLICT (subject_id, class_level_id) DO NOTHING;

ALTER TABLE subject_offerings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super_admin_subject_offerings" ON subject_offerings FOR ALL USING (is_super_admin());
CREATE POLICY "school_member_subject_offerings" ON subject_offerings FOR ALL USING (school_id = current_school_id());

GRANT ALL ON subject_offerings TO authenticated;


-- ── Simplified invite codes ──────────────────────────────────
-- Invites now only bring a teacher into the SCHOOL — they carry
-- no class/arm/subject targeting. All actual access is granted
-- afterward by a school admin via direct assignment. The old
-- columns stay (harmless, nullable already) for backward
-- compatibility with any invite rows created before this
-- migration, but the app stops writing to them going forward.
-- No column changes needed here — class_level_id, class_arm_id,
-- and subject_id on invite_codes were already nullable.

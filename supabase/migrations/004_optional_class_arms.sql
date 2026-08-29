-- ============================================================
-- CA-WIZARD | Migration 004 — Make Class Arms optional
-- ============================================================
-- Not every school streams by arm (A/B/Science/Arts). Rather than
-- add a per-school settings flag (more states to test everywhere
-- classes are touched), class_arm_id becomes nullable. Schools
-- that don't use arms simply never create any and always leave
-- it unset. Schools that do stream by arm use it normally — this
-- is actually MORE flexible than a per-school toggle, since a
-- single school could have JSS1 with no arms but SS1 split into
-- Science/Arts, which happens in practice.

ALTER TABLE classes ALTER COLUMN class_arm_id DROP NOT NULL;

-- The original inline UNIQUE(session_id, class_level_id, class_arm_id)
-- doesn't protect against duplicates when class_arm_id is NULL —
-- Postgres treats NULL <> NULL, so two "JSS1 (no arm)" rows for the
-- same session would both be allowed under a plain unique constraint.
-- Replace it with two indexes: one for arm-specified classes, one
-- partial index enforcing at most one arm-less class per level+session.
ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_session_id_class_level_id_class_arm_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_classes_unique_with_arm
  ON classes(session_id, class_level_id, class_arm_id)
  WHERE class_arm_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_classes_unique_without_arm
  ON classes(session_id, class_level_id)
  WHERE class_arm_id IS NULL;

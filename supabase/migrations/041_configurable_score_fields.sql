-- ============================================================
-- CA-WIZARD | Migration 041 — Configurable Score Fields (Schema)
-- ============================================================
-- Replaces the hardcoded 40:60 CA:Exam split and the separate
-- exam_scores table with a fully school-configurable field
-- system built on assessment_categories.
--
-- A field is either:
--   - 'input'    : a raw entered score (what assessment_categories
--                   already were — "Test 1", "Assignment", etc,
--                   and going forward "Exam" too).
--   - 'computed' : derived from other fields via score_field_sources,
--                   using compute_operation ('sum' | 'average' |
--                   'weighted_percentage').
--
-- show_on_report_card lets an admin choose which fields actually
-- print on the report card. is_total_field marks the one computed
-- field (at most one per school) whose value is the authoritative
-- "Total" — this is what grading looks up, and what always prints
-- regardless of show_on_report_card.
-- ============================================================

-- ---- Extend assessment_categories ----

CREATE TYPE score_field_type AS ENUM ('input', 'computed');
CREATE TYPE score_compute_operation AS ENUM ('sum', 'average', 'weighted_percentage');

ALTER TABLE assessment_categories
  ADD COLUMN field_type          score_field_type NOT NULL DEFAULT 'input',
  ADD COLUMN compute_operation   score_compute_operation,
  ADD COLUMN show_on_report_card BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN is_total_field      BOOLEAN NOT NULL DEFAULT FALSE;

-- A computed field must declare its operation; an input field must not.
ALTER TABLE assessment_categories
  ADD CONSTRAINT chk_field_type_operation CHECK (
    (field_type = 'input' AND compute_operation IS NULL) OR
    (field_type = 'computed' AND compute_operation IS NOT NULL)
  );

-- At most one is_total_field TRUE per school. Partial unique index
-- (not a plain UNIQUE constraint) since FALSE values are allowed to repeat.
CREATE UNIQUE INDEX idx_one_total_field_per_school
  ON assessment_categories(school_id)
  WHERE is_total_field = TRUE;

-- Guard: only a computed field can be the total field.
ALTER TABLE assessment_categories
  ADD CONSTRAINT chk_total_field_is_computed CHECK (
    NOT is_total_field OR field_type = 'computed'
  );

-- max_score stays NOT NULL/required for input fields (already the case).
-- For computed fields it's informational display-only (e.g. a
-- weighted_percentage's max is conceptually 100); we don't add a
-- separate constraint forcing a value — admins can leave the existing
-- default (10) or set 100, it doesn't drive the math.

-- ---- score_field_sources ----
-- Defines which fields feed a computed field, and their relative weight.
-- For 'sum'/'average': weight is typically 1 for every source (an
-- admin *could* set uneven weights for a weighted average, so we don't
-- forbid it — the compute engine just treats weight literally per op).
-- For 'weighted_percentage': weight is the point-share the source
-- contributes to the 100% total (e.g. CA categories summing to 40,
-- Exam at 60 reproduces the historical split).

CREATE TABLE score_field_sources (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id        UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  field_id         UUID NOT NULL REFERENCES assessment_categories(id) ON DELETE CASCADE,
  source_field_id  UUID NOT NULL REFERENCES assessment_categories(id) ON DELETE CASCADE,
  weight           NUMERIC(6,2) NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(field_id, source_field_id),
  CONSTRAINT chk_source_not_self CHECK (field_id != source_field_id)
);

CREATE INDEX idx_score_field_sources_school_id  ON score_field_sources(school_id);
CREATE INDEX idx_score_field_sources_field_id   ON score_field_sources(field_id);
CREATE INDEX idx_score_field_sources_source_id  ON score_field_sources(source_field_id);

ALTER TABLE score_field_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_score_field_sources" ON score_field_sources
  FOR ALL USING (is_super_admin());

CREATE POLICY "school_member_score_field_sources" ON score_field_sources
  FOR ALL USING (school_id = current_school_id());

-- ---- Trigger: a computed field can only source from fields in the
-- same school (defence in depth; app + RLS already scope by school,
-- but this makes it impossible even via a direct/service-role insert). ----

CREATE OR REPLACE FUNCTION check_score_field_source_same_school()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_field_school   UUID;
  v_source_school  UUID;
BEGIN
  SELECT school_id INTO v_field_school FROM public.assessment_categories WHERE id = NEW.field_id;
  SELECT school_id INTO v_source_school FROM public.assessment_categories WHERE id = NEW.source_field_id;

  IF v_field_school IS NULL OR v_source_school IS NULL THEN
    RAISE EXCEPTION 'score_field_sources: field_id or source_field_id does not exist';
  END IF;

  IF v_field_school != v_source_school OR v_field_school != NEW.school_id THEN
    RAISE EXCEPTION 'score_field_sources: field, source, and row school_id must all match';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_check_score_field_source_same_school
  BEFORE INSERT OR UPDATE ON score_field_sources
  FOR EACH ROW EXECUTE FUNCTION check_score_field_source_same_school();

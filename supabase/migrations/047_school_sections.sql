-- ============================================================
-- 047: School Sections (Early Years / Basic School / High School /
--      Sixth Form, or whatever a school calls its own tiers)
-- ============================================================
-- A purely organizational grouping ABOVE class_levels. A school
-- defines its own sections (same free-form, admin-named pattern as
-- class_levels/class_arms elsewhere in this schema — nothing
-- hardcoded), then optionally assigns each class_level to one.
--
-- Deliberately fully opt-in: section_id on class_levels is nullable,
-- and every piece of UI that groups by section falls back to its
-- existing flat/ungrouped display when a school has no sections
-- configured — a school that never touches this feature sees no
-- change whatsoever. No functional gating anywhere (not subject
-- offerings, not promotion rules) — display/grouping only, per the
-- agreed scope.
-- ============================================================

CREATE TABLE school_sections (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id    UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,             -- "Early Years", "Basic School", "High School", "Sixth Form"...
  order_index  INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(school_id, name)
);

CREATE INDEX idx_school_sections_school_id ON school_sections(school_id);

ALTER TABLE school_sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_school_sections" ON school_sections
  FOR ALL USING (is_super_admin());

CREATE POLICY "school_admin_manage_school_sections" ON school_sections
  FOR ALL USING (school_id = current_school_id() AND current_user_role() = 'school_admin');

-- Teachers can read (for grouped class pickers / dashboards) but not
-- modify — same read/write split already used for class_levels
-- elsewhere in this schema.
CREATE POLICY "teacher_read_school_sections" ON school_sections
  FOR SELECT USING (school_id = current_school_id() AND current_user_role() = 'teacher');

-- ---- class_levels gets an optional section ----

ALTER TABLE class_levels
  ADD COLUMN section_id UUID REFERENCES school_sections(id) ON DELETE SET NULL;

CREATE INDEX idx_class_levels_section_id ON class_levels(section_id);

-- Defence in depth: a class_level can only reference a section from
-- its OWN school (mirrors the same-school guard pattern used for
-- score_field_sources in migration 041) — the RLS policies above
-- already scope reads/writes by school, but this makes a cross-school
-- assignment impossible even via a direct/service-role write.
CREATE OR REPLACE FUNCTION check_class_level_section_same_school()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_section_school UUID;
BEGIN
  IF NEW.section_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT school_id INTO v_section_school FROM public.school_sections WHERE id = NEW.section_id;

  IF v_section_school IS NULL THEN
    RAISE EXCEPTION 'class_levels: section_id does not exist';
  END IF;

  IF v_section_school != NEW.school_id THEN
    RAISE EXCEPTION 'class_levels: section must belong to the same school';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_class_level_section_same_school ON class_levels;
CREATE TRIGGER trg_check_class_level_section_same_school
  BEFORE INSERT OR UPDATE OF section_id ON class_levels
  FOR EACH ROW EXECUTE FUNCTION check_class_level_section_same_school();

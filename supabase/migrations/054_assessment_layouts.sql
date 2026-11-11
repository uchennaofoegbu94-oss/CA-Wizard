-- 054_assessment_layouts.sql
--
-- Assessment LAYOUTS: a named set of score fields (the thing admins build on
-- the Assessments page; it also drives Score Entry columns, the Pre-CA PDF and
-- report-card columns).
--
--   * Every school has exactly ONE default layout (section_id IS NULL) that
--     applies to the whole school, exactly as before.
--   * A school may also give any school_section its OWN layout (at most one per
--     section). Classes in that section use it instead of the default.
--   * Only the school admin can touch the default layout or create/remove
--     layouts for any section. A section admin who has been granted the new
--     `can_manage_assessments` toggle can create and manage the layout of
--     THEIR section only — never another section's, never the default.
--
-- Existing data: each school's current fields are moved into its default
-- layout, so nothing changes for any school until someone creates a section
-- layout.
--
-- Safety design (these are deliberate, see the notes at each spot):
--   * Creating a section layout from the default also REMAPS that section's
--     existing scores to the cloned fields, in one transaction. Without that,
--     scores already entered would silently disappear from reports (they
--     would still point at the old fields).
--   * A blank layout is refused when the section already has scores, for the
--     same reason.
--   * FKs from layout -> fields are RESTRICT, and layouts are removed only via
--     delete_assessment_layout(), which refuses if any score exists. A plain
--     cascade here would delete student_scores.
--
-- NEW-SUPABASE-GRANTS RULE: the new table has explicit GRANTs below.

-- ───────────────────────── 1. Table ─────────────────────────
CREATE TABLE assessment_layouts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id   UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  section_id  UUID REFERENCES school_sections(id) ON DELETE RESTRICT,
  name        TEXT NOT NULL,
  created_by  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_assessment_layout_per_section ON assessment_layouts(school_id, section_id) WHERE section_id IS NOT NULL;
CREATE UNIQUE INDEX uq_assessment_default_layout_per_school ON assessment_layouts(school_id) WHERE section_id IS NULL;
CREATE INDEX idx_assessment_layouts_school_id ON assessment_layouts(school_id);

CREATE TRIGGER trg_assessment_layouts_updated_at
  BEFORE UPDATE ON assessment_layouts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE assessment_layouts ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.assessment_layouts TO authenticated;
GRANT ALL ON public.assessment_layouts TO service_role;

-- A layout's section must belong to the same school
CREATE OR REPLACE FUNCTION check_assessment_layout_same_school()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_section_school UUID;
BEGIN
  IF NEW.section_id IS NOT NULL THEN
    SELECT school_id INTO v_section_school FROM school_sections WHERE id = NEW.section_id;
    IF v_section_school IS DISTINCT FROM NEW.school_id THEN
      RAISE EXCEPTION 'assessment_layouts: section belongs to a different school';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_check_assessment_layout_same_school
  BEFORE INSERT OR UPDATE ON assessment_layouts FOR EACH ROW EXECUTE FUNCTION check_assessment_layout_same_school();

-- ───────────────────────── 2. Section-admin toggle ─────────────────────────
ALTER TABLE section_admins ADD COLUMN can_manage_assessments BOOLEAN NOT NULL DEFAULT FALSE;

-- Class-based helper (used by RLS elsewhere): add the new arm, everything else unchanged
CREATE OR REPLACE FUNCTION has_section_permission(p_class_id UUID, p_permission TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_section_id UUID; v_profile_id UUID; v_ok BOOLEAN;
BEGIN
  v_section_id := class_section_id(p_class_id);
  IF v_section_id IS NULL THEN RETURN FALSE; END IF;
  SELECT id INTO v_profile_id FROM profiles WHERE user_id = auth.uid();
  IF v_profile_id IS NULL THEN RETURN FALSE; END IF;
  SELECT CASE p_permission
    WHEN 'can_enroll_students'    THEN bool_or(can_enroll_students)
    WHEN 'can_assign_teachers'    THEN bool_or(can_assign_teachers)
    WHEN 'can_manage_assessments' THEN bool_or(can_manage_assessments)
    WHEN 'can_download_documents' THEN bool_or(can_download_documents)
    ELSE FALSE
  END INTO v_ok
  FROM section_admins WHERE teacher_id = v_profile_id AND section_id = v_section_id;
  RETURN COALESCE(v_ok, FALSE);
END $$;

-- Section-based helper (layouts hang off sections, not classes)
CREATE OR REPLACE FUNCTION has_section_grant(p_section_id UUID, p_permission TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_profile_id UUID; v_ok BOOLEAN;
BEGIN
  IF p_section_id IS NULL THEN RETURN FALSE; END IF;
  SELECT id INTO v_profile_id FROM profiles WHERE user_id = auth.uid() AND is_active;
  IF v_profile_id IS NULL THEN RETURN FALSE; END IF;
  SELECT CASE p_permission
    WHEN 'can_enroll_students'    THEN bool_or(can_enroll_students)
    WHEN 'can_assign_teachers'    THEN bool_or(can_assign_teachers)
    WHEN 'can_manage_assessments' THEN bool_or(can_manage_assessments)
    WHEN 'can_download_documents' THEN bool_or(can_download_documents)
    ELSE FALSE
  END INTO v_ok
  FROM section_admins WHERE teacher_id = v_profile_id AND section_id = p_section_id;
  RETURN COALESCE(v_ok, FALSE);
END $$;

-- Who may write to a layout (and therefore its fields/sources)?
--   school admin of that school, super admin, or a section admin with the
--   toggle for THAT layout's section. The default layout (section NULL) is
--   school-admin/super-admin only.
CREATE OR REPLACE FUNCTION can_manage_layout(p_layout_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_school UUID; v_section UUID;
BEGIN
  SELECT school_id, section_id INTO v_school, v_section FROM assessment_layouts WHERE id = p_layout_id;
  IF v_school IS NULL THEN RETURN FALSE; END IF;
  RETURN COALESCE(
    is_super_admin()
    OR (current_school_id() = v_school AND current_user_role() = 'school_admin')
    OR (current_school_id() = v_school AND v_section IS NOT NULL AND has_section_grant(v_section, 'can_manage_assessments')),
    FALSE);
END $$;

-- ───────────────────────── 3. Layout column on fields + backfill ─────────────────────────
ALTER TABLE assessment_categories ADD COLUMN layout_id UUID REFERENCES assessment_layouts(id) ON DELETE RESTRICT;

-- One default layout per existing school (including schools with no fields yet)
INSERT INTO assessment_layouts (school_id, section_id, name)
SELECT s.id, NULL, 'School default' FROM schools s;

UPDATE assessment_categories ac
SET layout_id = l.id
FROM assessment_layouts l
WHERE l.school_id = ac.school_id AND l.section_id IS NULL;

ALTER TABLE assessment_categories ALTER COLUMN layout_id SET NOT NULL;
CREATE INDEX idx_assessment_categories_layout_id ON assessment_categories(layout_id);

-- Uniqueness is now per layout, not per school
ALTER TABLE assessment_categories DROP CONSTRAINT assessment_categories_school_id_name_key;
ALTER TABLE assessment_categories ADD CONSTRAINT assessment_categories_layout_id_name_key UNIQUE (layout_id, name);
DROP INDEX idx_one_total_field_per_school;
CREATE UNIQUE INDEX idx_one_total_field_per_layout ON assessment_categories(layout_id) WHERE is_total_field = TRUE;

-- A field's layout must belong to the same school; and a field inserted
-- without a layout (e.g. older client code) lands in the school's default.
CREATE OR REPLACE FUNCTION assessment_category_layout_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_layout_school UUID;
BEGIN
  IF NEW.layout_id IS NULL THEN
    SELECT id INTO NEW.layout_id FROM assessment_layouts WHERE school_id = NEW.school_id AND section_id IS NULL;
    IF NEW.layout_id IS NULL THEN
      INSERT INTO assessment_layouts (school_id, section_id, name) VALUES (NEW.school_id, NULL, 'School default')
      RETURNING id INTO NEW.layout_id;
    END IF;
  END IF;
  SELECT school_id INTO v_layout_school FROM assessment_layouts WHERE id = NEW.layout_id;
  IF v_layout_school IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'assessment_categories: layout belongs to a different school';
  END IF;
  RETURN NEW;
END $$;
-- BEFORE INSERT only needs the default-fill; the school check also guards UPDATE of layout_id
CREATE TRIGGER trg_assessment_category_layout_guard
  BEFORE INSERT OR UPDATE OF layout_id, school_id ON assessment_categories
  FOR EACH ROW EXECUTE FUNCTION assessment_category_layout_guard();

-- Computed fields may only draw on fields of the SAME layout. Extends the
-- existing same-school/cycle check; body below is the 041 logic plus that rule.
CREATE OR REPLACE FUNCTION check_score_field_source_same_school()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_field_school UUID; v_source_school UUID; v_field_layout UUID; v_source_layout UUID; v_cycle BOOLEAN;
BEGIN
  SELECT school_id, layout_id INTO v_field_school, v_field_layout FROM public.assessment_categories WHERE id = NEW.field_id;
  SELECT school_id, layout_id INTO v_source_school, v_source_layout FROM public.assessment_categories WHERE id = NEW.source_field_id;

  IF v_field_school IS NULL OR v_source_school IS NULL THEN
    RAISE EXCEPTION 'score_field_sources: field_id or source_field_id does not exist';
  END IF;
  IF v_field_school != v_source_school OR v_field_school != NEW.school_id THEN
    RAISE EXCEPTION 'score_field_sources: field, source, and row school_id must all match';
  END IF;
  IF v_field_layout != v_source_layout THEN
    RAISE EXCEPTION 'score_field_sources: a computed field can only use fields from its own layout';
  END IF;

  WITH RECURSIVE reachable AS (
    SELECT source_field_id AS node FROM public.score_field_sources WHERE field_id = NEW.source_field_id
    UNION
    SELECT sfs.source_field_id FROM public.score_field_sources sfs JOIN reachable r ON sfs.field_id = r.node
  )
  SELECT EXISTS (SELECT 1 FROM reachable WHERE node = NEW.field_id) INTO v_cycle;
  IF v_cycle THEN
    RAISE EXCEPTION 'score_field_sources: this would create a circular dependency between computed fields';
  END IF;
  RETURN NEW;
END $$;

-- ───────────────────────── 4. Layout lookup helpers ─────────────────────────
-- Layout a class uses: its section's layout if the section has one, else the school default.
CREATE OR REPLACE FUNCTION layout_for_class(p_class_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(
    (SELECT l.id FROM assessment_layouts l WHERE l.school_id = c.school_id AND l.section_id = cl.section_id),
    (SELECT l.id FROM assessment_layouts l WHERE l.school_id = c.school_id AND l.section_id IS NULL)
  )
  FROM classes c JOIN class_levels cl ON cl.id = c.class_level_id
  WHERE c.id = p_class_id;
$$;

-- Layout used for a student in a given term: class they were enrolled in for
-- that term's session (latest enrolment wins); falls back to the school default.
CREATE OR REPLACE FUNCTION layout_for_student_term(p_student_id UUID, p_term_id UUID)
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(
    (SELECT layout_for_class(se.class_id)
       FROM student_enrollments se JOIN terms t ON t.session_id = se.session_id
      WHERE se.student_id = p_student_id AND t.id = p_term_id
      ORDER BY se.enrolled_at DESC LIMIT 1),
    (SELECT l.id FROM assessment_layouts l JOIN students s ON s.school_id = l.school_id
      WHERE s.id = p_student_id AND l.section_id IS NULL)
  );
$$;

-- ───────────────────────── 5. Layout-aware scoring engine ─────────────────────────
-- resolve_score_fields gains p_layout_id; the 4-arg version is dropped.
-- Internal-only: it trusts its arguments, so it is NOT executable by API roles
-- (it previously was, which let any signed-in user read another school's scores
-- by calling it directly). The authorised RPCs below call it as the owner.
DROP FUNCTION resolve_score_fields(UUID, UUID, UUID, UUID);

CREATE FUNCTION resolve_score_fields(p_school_id UUID, p_student_id UUID, p_subject_id UUID, p_term_id UUID, p_layout_id UUID)
RETURNS TABLE(field_id UUID, field_name TEXT, field_type score_field_type, compute_operation score_compute_operation, order_index INTEGER,
              show_on_report_card BOOLEAN, show_on_score_entry BOOLEAN, is_total_field BOOLEAN, value NUMERIC, max_value NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  v_resolved   JSONB := '{}'::jsonb;
  v_progress   BOOLEAN;
  v_field      RECORD;
  v_src        RECORD;
  v_val        NUMERIC;
  v_max        NUMERIC;
  v_all_ready  BOOLEAN;
  v_sum_val    NUMERIC;
  v_sum_max    NUMERIC;
  v_sum_weight NUMERIC;
  v_sum_pct    NUMERIC;
BEGIN
  FOR v_field IN
    SELECT ac.id, ac.max_score FROM assessment_categories ac
    WHERE ac.school_id = p_school_id AND ac.layout_id = p_layout_id AND ac.field_type = 'input' AND ac.is_active = TRUE
  LOOP
    SELECT COALESCE(ss.score, 0) INTO v_val
    FROM student_scores ss
    WHERE ss.assessment_category_id = v_field.id AND ss.student_id = p_student_id
      AND ss.subject_id = p_subject_id AND ss.term_id = p_term_id;
    v_resolved := v_resolved || jsonb_build_object(
      v_field.id::text, jsonb_build_object('value', COALESCE(v_val, 0), 'max_value', v_field.max_score));
  END LOOP;

  LOOP
    v_progress := FALSE;
    FOR v_field IN
      SELECT ac.id, ac.compute_operation FROM assessment_categories ac
      WHERE ac.school_id = p_school_id AND ac.layout_id = p_layout_id AND ac.field_type = 'computed' AND ac.is_active = TRUE
        AND NOT (v_resolved ? ac.id::text)
    LOOP
      v_all_ready := TRUE;
      v_sum_val := 0; v_sum_max := 0; v_sum_weight := 0; v_sum_pct := 0;
      FOR v_src IN SELECT sfs.source_field_id, sfs.weight FROM score_field_sources sfs WHERE sfs.field_id = v_field.id LOOP
        IF NOT (v_resolved ? v_src.source_field_id::text) THEN v_all_ready := FALSE; EXIT; END IF;
        v_val := (v_resolved -> v_src.source_field_id::text ->> 'value')::numeric;
        v_max := (v_resolved -> v_src.source_field_id::text ->> 'max_value')::numeric;
        v_sum_val := v_sum_val + v_val * v_src.weight;
        v_sum_max := v_sum_max + v_max * v_src.weight;
        v_sum_weight := v_sum_weight + v_src.weight;
        IF v_max > 0 THEN v_sum_pct := v_sum_pct + (v_val / v_max) * v_src.weight; END IF;
      END LOOP;

      IF v_all_ready THEN
        CASE v_field.compute_operation
          WHEN 'sum' THEN
            v_resolved := v_resolved || jsonb_build_object(v_field.id::text, jsonb_build_object('value', ROUND(v_sum_val, 2), 'max_value', ROUND(v_sum_max, 2)));
          WHEN 'average' THEN
            v_resolved := v_resolved || jsonb_build_object(v_field.id::text, jsonb_build_object(
              'value', ROUND(v_sum_val / NULLIF(v_sum_weight, 0), 2), 'max_value', ROUND(v_sum_max / NULLIF(v_sum_weight, 0), 2)));
          WHEN 'weighted_percentage' THEN
            v_resolved := v_resolved || jsonb_build_object(v_field.id::text, jsonb_build_object('value', ROUND(v_sum_pct, 2), 'max_value', ROUND(v_sum_weight, 2)));
        END CASE;
        v_progress := TRUE;
      END IF;
    END LOOP;
    EXIT WHEN NOT v_progress;
  END LOOP;

  RETURN QUERY
  SELECT ac.id, ac.name, ac.field_type, ac.compute_operation, ac.order_index,
         ac.show_on_report_card, ac.show_on_score_entry, ac.is_total_field,
         (v_resolved -> ac.id::text ->> 'value')::numeric, (v_resolved -> ac.id::text ->> 'max_value')::numeric
  FROM assessment_categories ac
  WHERE ac.school_id = p_school_id AND ac.layout_id = p_layout_id AND ac.is_active = TRUE AND (v_resolved ? ac.id::text)
  ORDER BY ac.order_index;
END;
$function$;
REVOKE EXECUTE ON FUNCTION resolve_score_fields(UUID, UUID, UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;

-- Single student (school admin only) — layout from the student's class that term
CREATE OR REPLACE FUNCTION get_score_fields(p_student_id UUID, p_subject_id UUID, p_term_id UUID)
RETURNS TABLE(field_id UUID, field_name TEXT, field_type score_field_type, compute_operation score_compute_operation, order_index INTEGER,
              show_on_report_card BOOLEAN, show_on_score_entry BOOLEAN, is_total_field BOOLEAN, value NUMERIC, max_value NUMERIC)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE v_school_id UUID;
BEGIN
  SELECT school_id INTO v_school_id FROM students WHERE id = p_student_id;
  IF v_school_id IS NULL THEN RAISE EXCEPTION 'get_score_fields: student not found'; END IF;
  IF NOT COALESCE((is_super_admin() OR (current_school_id() = v_school_id AND current_user_role() = 'school_admin')), FALSE) THEN
    RAISE EXCEPTION 'get_score_fields: not authorized for this student''s school';
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
  ), FALSE) THEN
    RAISE EXCEPTION 'get_class_subject_term_results: not authorized for this class';
  END IF;
  v_layout := layout_for_class(p_class_id);
  RETURN QUERY
  SELECT r.student_id, rf.*
  FROM (SELECT DISTINCT student_enrollments.student_id FROM student_enrollments WHERE class_id = p_class_id) r
  CROSS JOIN LATERAL resolve_score_fields(v_school_id, r.student_id, p_subject_id, p_term_id, v_layout) rf
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
  ), FALSE) THEN
    RAISE EXCEPTION 'get_class_all_fields: not authorized for this class';
  END IF;
  v_layout := layout_for_class(p_class_id);
  RETURN QUERY
  SELECT r.student_id, cs.subject_id, rf.*
  FROM (SELECT DISTINCT student_enrollments.student_id FROM student_enrollments WHERE class_id = p_class_id) r
  CROSS JOIN (
    SELECT DISTINCT student_scores.subject_id FROM student_scores WHERE class_id = p_class_id AND term_id = p_term_id
    UNION
    SELECT DISTINCT teacher_assignments.subject_id FROM teacher_assignments WHERE class_id = p_class_id AND teacher_assignments.subject_id IS NOT NULL
  ) cs
  CROSS JOIN LATERAL resolve_score_fields(v_school_id, r.student_id, cs.subject_id, p_term_id, v_layout) rf
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
  WHERE rf.is_total_field;
END;
$function$;

-- ───────────────────────── 6. RLS ─────────────────────────
-- assessment_layouts
CREATE POLICY super_admin_assessment_layouts ON assessment_layouts FOR ALL USING (is_super_admin());
CREATE POLICY school_member_read_assessment_layouts ON assessment_layouts FOR SELECT USING (school_id = current_school_id());
CREATE POLICY layout_insert ON assessment_layouts FOR INSERT WITH CHECK (
  school_id = current_school_id()
  AND (current_user_role() = 'school_admin' OR (section_id IS NOT NULL AND has_section_grant(section_id, 'can_manage_assessments')))
);
CREATE POLICY layout_update ON assessment_layouts FOR UPDATE
  USING (can_manage_layout(id))
  WITH CHECK (school_id = current_school_id()
    AND (current_user_role() = 'school_admin' OR (section_id IS NOT NULL AND has_section_grant(section_id, 'can_manage_assessments'))));
-- Deleting goes through delete_assessment_layout() (refuses when scores exist); direct DELETE is admin-only as a backstop
CREATE POLICY layout_delete ON assessment_layouts FOR DELETE USING (school_id = current_school_id() AND current_user_role() = 'school_admin');

-- assessment_categories: was ONE policy letting every school member (teachers included) write.
-- Reads stay school-wide (teachers need the columns); writes are limited to people who can manage the layout.
DROP POLICY school_member_assessment_cat ON assessment_categories;
CREATE POLICY school_member_read_assessment_cat ON assessment_categories FOR SELECT USING (school_id = current_school_id());
CREATE POLICY layout_manager_insert_assessment_cat ON assessment_categories FOR INSERT
  WITH CHECK (school_id = current_school_id() AND can_manage_layout(layout_id));
CREATE POLICY layout_manager_update_assessment_cat ON assessment_categories FOR UPDATE
  USING (can_manage_layout(layout_id)) WITH CHECK (school_id = current_school_id() AND can_manage_layout(layout_id));
CREATE POLICY layout_manager_delete_assessment_cat ON assessment_categories FOR DELETE USING (can_manage_layout(layout_id));

-- score_field_sources: same split, resolved through the field's layout
DROP POLICY school_member_score_field_sources ON score_field_sources;
CREATE POLICY school_member_read_score_field_sources ON score_field_sources FOR SELECT USING (school_id = current_school_id());
CREATE POLICY layout_manager_write_score_field_sources ON score_field_sources FOR INSERT
  WITH CHECK (school_id = current_school_id()
    AND can_manage_layout((SELECT layout_id FROM assessment_categories WHERE id = field_id)));
CREATE POLICY layout_manager_update_score_field_sources ON score_field_sources FOR UPDATE
  USING (can_manage_layout((SELECT layout_id FROM assessment_categories WHERE id = field_id)))
  WITH CHECK (school_id = current_school_id() AND can_manage_layout((SELECT layout_id FROM assessment_categories WHERE id = field_id)));
CREATE POLICY layout_manager_delete_score_field_sources ON score_field_sources FOR DELETE
  USING (can_manage_layout((SELECT layout_id FROM assessment_categories WHERE id = field_id)));

-- ───────────────────────── 7. Guarded layout RPCs ─────────────────────────
-- Create the layout for a section. p_copy_default = TRUE clones the school default's
-- fields/sources AND moves the section's existing scores onto the clones.
CREATE OR REPLACE FUNCTION create_section_layout(p_section_id UUID, p_name TEXT, p_copy_default BOOLEAN DEFAULT TRUE)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_school UUID; v_profile UUID; v_default UUID; v_new UUID; v_has_scores BOOLEAN;
  v_old RECORD; v_map JSONB := '{}'::jsonb; v_new_field UUID;
BEGIN
  SELECT school_id INTO v_school FROM school_sections WHERE id = p_section_id;
  IF v_school IS NULL THEN RAISE EXCEPTION 'create_section_layout: section not found'; END IF;
  IF NOT COALESCE(is_super_admin()
      OR (current_school_id() = v_school AND current_user_role() = 'school_admin')
      OR (current_school_id() = v_school AND has_section_grant(p_section_id, 'can_manage_assessments')), FALSE) THEN
    RAISE EXCEPTION 'create_section_layout: not authorized for this section';
  END IF;
  IF EXISTS (SELECT 1 FROM assessment_layouts WHERE school_id = v_school AND section_id = p_section_id) THEN
    RAISE EXCEPTION 'create_section_layout: this section already has its own layout';
  END IF;

  SELECT id INTO v_profile FROM profiles WHERE user_id = auth.uid();
  SELECT id INTO v_default FROM assessment_layouts WHERE school_id = v_school AND section_id IS NULL;

  SELECT EXISTS (
    SELECT 1 FROM student_scores ss JOIN classes c ON c.id = ss.class_id JOIN class_levels cl ON cl.id = c.class_level_id
    WHERE cl.section_id = p_section_id
  ) INTO v_has_scores;

  IF v_has_scores AND NOT p_copy_default THEN
    RAISE EXCEPTION 'create_section_layout: this section already has recorded scores. Start from a copy of the school default so they carry over.';
  END IF;

  INSERT INTO assessment_layouts (school_id, section_id, name, created_by)
  VALUES (v_school, p_section_id, COALESCE(NULLIF(trim(p_name), ''), 'Section layout'), v_profile)
  RETURNING id INTO v_new;

  IF p_copy_default AND v_default IS NOT NULL THEN
    -- inputs first, then computed (sources must exist before they are referenced)
    FOR v_old IN SELECT * FROM assessment_categories WHERE layout_id = v_default ORDER BY (field_type = 'computed'), order_index LOOP
      INSERT INTO assessment_categories (school_id, layout_id, name, max_score, order_index, is_active, field_type, compute_operation,
                                         show_on_report_card, is_total_field, show_on_score_entry)
      VALUES (v_school, v_new, v_old.name, v_old.max_score, v_old.order_index, v_old.is_active, v_old.field_type, v_old.compute_operation,
              v_old.show_on_report_card, v_old.is_total_field, v_old.show_on_score_entry)
      RETURNING id INTO v_new_field;
      v_map := v_map || jsonb_build_object(v_old.id::text, v_new_field::text);
    END LOOP;

    INSERT INTO score_field_sources (school_id, field_id, source_field_id, weight)
    SELECT v_school, (v_map ->> sfs.field_id::text)::uuid, (v_map ->> sfs.source_field_id::text)::uuid, sfs.weight
    FROM score_field_sources sfs
    WHERE sfs.field_id IN (SELECT id FROM assessment_categories WHERE layout_id = v_default);

    -- Carry the section's already-entered scores over to the cloned fields
    FOR v_old IN SELECT key AS old_id, value #>> '{}' AS new_id FROM jsonb_each(v_map) LOOP
      UPDATE student_scores ss
      SET assessment_category_id = v_old.new_id::uuid
      WHERE ss.assessment_category_id = v_old.old_id::uuid
        AND ss.class_id IN (SELECT c.id FROM classes c JOIN class_levels cl ON cl.id = c.class_level_id WHERE cl.section_id = p_section_id);
    END LOOP;
  END IF;

  RETURN v_new;
END $$;
REVOKE EXECUTE ON FUNCTION create_section_layout(UUID, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION create_section_layout(UUID, TEXT, BOOLEAN) TO authenticated;

-- Remove a SECTION layout (the section falls back to the school default).
-- Refuses if any score is recorded against its fields — removing would orphan them.
CREATE OR REPLACE FUNCTION delete_assessment_layout(p_layout_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_school UUID; v_section UUID;
BEGIN
  SELECT school_id, section_id INTO v_school, v_section FROM assessment_layouts WHERE id = p_layout_id;
  IF v_school IS NULL THEN RAISE EXCEPTION 'delete_assessment_layout: layout not found'; END IF;
  IF v_section IS NULL THEN RAISE EXCEPTION 'delete_assessment_layout: the school default layout cannot be deleted'; END IF;
  IF NOT COALESCE(is_super_admin()
      OR (current_school_id() = v_school AND current_user_role() = 'school_admin')
      OR (current_school_id() = v_school AND has_section_grant(v_section, 'can_manage_assessments')), FALSE) THEN
    RAISE EXCEPTION 'delete_assessment_layout: not authorized';
  END IF;
  IF EXISTS (SELECT 1 FROM student_scores ss JOIN assessment_categories ac ON ac.id = ss.assessment_category_id WHERE ac.layout_id = p_layout_id) THEN
    RAISE EXCEPTION 'delete_assessment_layout: scores have been recorded with this layout, so it cannot be removed';
  END IF;
  DELETE FROM assessment_categories WHERE layout_id = p_layout_id;
  DELETE FROM assessment_layouts WHERE id = p_layout_id;
END $$;
REVOKE EXECUTE ON FUNCTION delete_assessment_layout(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION delete_assessment_layout(UUID) TO authenticated;

-- New schools: give each its default layout at creation time
CREATE OR REPLACE FUNCTION create_default_assessment_layout()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO assessment_layouts (school_id, section_id, name) VALUES (NEW.id, NULL, 'School default')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_create_default_assessment_layout AFTER INSERT ON schools FOR EACH ROW EXECUTE FUNCTION create_default_assessment_layout();

-- ───────────────────────── 7b. Deleting a field that has scores ─────────────────────────
-- student_scores cascades from assessment_categories, so deleting a field wipes
-- every score recorded under it. A section admin may manage their layout, but
-- destroying recorded scores stays a school-admin (or super-admin) action.
-- (delete_assessment_layout() already refuses when any score exists, so it is unaffected.)
CREATE OR REPLACE FUNCTION guard_delete_scored_category()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM student_scores WHERE assessment_category_id = OLD.id)
     AND NOT COALESCE(is_super_admin() OR (current_school_id() = OLD.school_id AND current_user_role() = 'school_admin'), FALSE)
     AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'Scores have been recorded under "%". Only the school admin can delete a field that has scores — you can switch it off (inactive) instead.', OLD.name;
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER trg_guard_delete_scored_category BEFORE DELETE ON assessment_categories
  FOR EACH ROW EXECUTE FUNCTION guard_delete_scored_category();

-- ───────────────────────── 8. Function privileges ─────────────────────────
-- New functions default to EXECUTE for PUBLIC (including anon). Lock down the
-- internal lookups; keep only what RLS expressions / the app genuinely call.
REVOKE EXECUTE ON FUNCTION layout_for_class(UUID)                       FROM PUBLIC, anon, authenticated;  -- internal (definer RPCs call it as owner)
REVOKE EXECUTE ON FUNCTION layout_for_student_term(UUID, UUID)          FROM PUBLIC, anon, authenticated;  -- internal
REVOKE EXECUTE ON FUNCTION can_manage_layout(UUID)                      FROM PUBLIC, anon;                 -- used in RLS policies -> authenticated keeps it
REVOKE EXECUTE ON FUNCTION has_section_grant(UUID, TEXT)                FROM PUBLIC, anon;                 -- used in RLS policies -> authenticated keeps it
GRANT  EXECUTE ON FUNCTION can_manage_layout(UUID)                      TO authenticated;
GRANT  EXECUTE ON FUNCTION has_section_grant(UUID, TEXT)                TO authenticated;

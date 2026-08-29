-- ============================================================
-- 016: archive / restore teacher
-- ============================================================
-- Mirrors how a student who leaves is handled (status changes,
-- record kept, no hard delete) rather than the withdrawn-in-place
-- history students get: for a teacher, "left the school" means their
-- profile stays (so past scores/comments/audit entries still show who
-- entered them), is_active flips to false (already enforced app-wide
-- by RequireAuth — this alone blocks login), and their
-- teacher_assignments rows are actually deleted (not just hidden),
-- since a departed teacher having live class/subject access floating
-- around is exactly the kind of stale-permission problem this feature
-- exists to close.
--
-- These need to be SECURITY DEFINER functions, not direct client
-- updates: profiles RLS only allows a school_admin to SELECT other
-- profiles in their school, never UPDATE them (only own_profile or
-- super_admin can) — the same reason set_school_admin_status already
-- exists as an RPC rather than a plain client-side update.

CREATE OR REPLACE FUNCTION archive_teacher(p_teacher_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_teacher_school_id UUID;
BEGIN
  SELECT school_id INTO v_teacher_school_id FROM profiles WHERE id = p_teacher_id AND role = 'teacher';
  IF v_teacher_school_id IS NULL THEN
    RAISE EXCEPTION 'Teacher not found';
  END IF;
  IF NOT (current_school_id() = v_teacher_school_id OR is_super_admin()) THEN
    RAISE EXCEPTION 'Not authorized to archive this teacher';
  END IF;

  UPDATE profiles SET is_active = false, updated_at = now() WHERE id = p_teacher_id;
  DELETE FROM teacher_assignments WHERE teacher_id = p_teacher_id;
END;
$$;

CREATE OR REPLACE FUNCTION restore_teacher(p_teacher_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_teacher_school_id UUID;
BEGIN
  SELECT school_id INTO v_teacher_school_id FROM profiles WHERE id = p_teacher_id AND role = 'teacher';
  IF v_teacher_school_id IS NULL THEN
    RAISE EXCEPTION 'Teacher not found';
  END IF;
  IF NOT (current_school_id() = v_teacher_school_id OR is_super_admin()) THEN
    RAISE EXCEPTION 'Not authorized to restore this teacher';
  END IF;

  -- Assignments were deleted on archive and are NOT recreated here —
  -- there's nothing to restore them from. A returning teacher gets
  -- fresh assignments via the normal Assign flow, same as onboarding
  -- any other teacher.
  UPDATE profiles SET is_active = true, updated_at = now() WHERE id = p_teacher_id;
END;
$$;

GRANT EXECUTE ON FUNCTION archive_teacher TO authenticated;
GRANT EXECUTE ON FUNCTION restore_teacher TO authenticated;

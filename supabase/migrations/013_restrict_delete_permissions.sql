-- ============================================================
-- 013: restrict student/session deletion to school_admin, and
-- guard against catastrophic session deletion
-- ============================================================
-- Both students and sessions previously had a single FOR ALL
-- policy keyed only on school_id = current_school_id() — meaning
-- any school member, including a teacher, technically had DELETE
-- access via the API even though nothing in the UI exposed it.
-- Splitting these into SELECT/INSERT/UPDATE (unchanged, still any
-- school member) + a separate DELETE policy restricted to
-- school_admin closes that gap now that a delete action is
-- actually being wired up in the UI.

DROP POLICY IF EXISTS "school_member_students" ON students;
CREATE POLICY "school_member_students_rw" ON students FOR SELECT USING (school_id = current_school_id());
CREATE POLICY "school_member_students_insert" ON students FOR INSERT WITH CHECK (school_id = current_school_id());
CREATE POLICY "school_member_students_update" ON students FOR UPDATE USING (school_id = current_school_id());
CREATE POLICY "school_admin_students_delete" ON students FOR DELETE
  USING (school_id = current_school_id() AND current_user_role() = 'school_admin');

DROP POLICY IF EXISTS "school_member_sessions" ON sessions;
CREATE POLICY "school_member_sessions_rw" ON sessions FOR SELECT USING (school_id = current_school_id());
CREATE POLICY "school_member_sessions_insert" ON sessions FOR INSERT WITH CHECK (school_id = current_school_id());
CREATE POLICY "school_member_sessions_update" ON sessions FOR UPDATE USING (school_id = current_school_id());
CREATE POLICY "school_admin_sessions_delete" ON sessions FOR DELETE
  USING (school_id = current_school_id() AND current_user_role() = 'school_admin');

-- A session cascades to terms, classes, and enrollments on delete, which
-- in turn cascade to results/attendance/comments/scores under those —
-- i.e. deleting a session with any real activity under it means deleting
-- an entire academic year's records. The client checks for this and
-- blocks the button, but that's a UX courtesy, not a security boundary —
-- this trigger is the actual guarantee. Only a session with zero terms
-- and zero classes (created by mistake, never used) can be deleted.
CREATE OR REPLACE FUNCTION prevent_unsafe_session_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_term_count  INT;
  v_class_count INT;
BEGIN
  SELECT count(*) INTO v_term_count FROM terms WHERE session_id = OLD.id;
  SELECT count(*) INTO v_class_count FROM classes WHERE session_id = OLD.id;
  IF v_term_count > 0 OR v_class_count > 0 THEN
    RAISE EXCEPTION 'Cannot delete a session that still has terms or classes. Remove those first, or leave the session as historical record.';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_unsafe_session_delete ON sessions;
CREATE TRIGGER trg_prevent_unsafe_session_delete
  BEFORE DELETE ON sessions
  FOR EACH ROW EXECUTE FUNCTION prevent_unsafe_session_delete();

-- ============================================================
-- 051: Tighten students UPDATE
-- ============================================================
-- Closes the same class of loophole as 049 did for students INSERT
-- and student_enrollments INSERT/UPDATE/DELETE: school_member_
-- students_update (013) let ANY school member — including a plain
-- teacher with zero section_admins grants — update any student row
-- at their school. Confirmed by code search (same method as 049):
-- no teacher-facing page performs a students UPDATE. The pages that
-- legitimately write to a *student's records* for a term — attendance,
-- comments, affective/psychomotor scores, all reachable by teachers
-- via /teacher/records (TermRecordsPage) — write to their own
-- separate tables (attendance, comments, affective_scores,
-- psychomotor_scores), never to the students row itself, so none of
-- that is affected by this change.
--
-- No new permission is added for section admins here either — editing
-- a student's own record (name, DOB, status, etc.) was never one of
-- the 3 grantable capabilities (add/enroll/assign), so this is
-- straightforwardly admin-only now, matching students DELETE (013)
-- and the enrollments UPDATE/DELETE split in 049.

DROP POLICY IF EXISTS "school_member_students_update" ON students;
CREATE POLICY "school_admin_students_update" ON students
  FOR UPDATE USING (school_id = current_school_id() AND current_user_role() = 'school_admin');

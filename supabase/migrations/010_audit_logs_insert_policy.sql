-- ============================================================
-- 010: audit_logs INSERT policy for school-level actors
-- ============================================================
-- Root cause of "no school-admin actions ever show up in Audit Logs":
-- audit_logs RLS had only two policies —
--   super_admin_audit      FOR ALL    USING (is_super_admin())
--   school_admin_audit_read FOR SELECT USING (school_id = current_school_id() ...)
-- There was never an INSERT policy for anyone other than super admins.
-- Every client-side logAudit() call made by a school_admin (or, in future,
-- a teacher) — Students, Classes, Subjects, Sessions, Grading, Assessments,
-- Promotion, LOGIN/LOGOUT — has been silently rejected by RLS since the
-- very first audit wiring. logAudit() deliberately swallows errors so a
-- failed log call never breaks the underlying feature, which is why this
-- went unnoticed: every mutation "worked", just nothing was ever recorded.
--
-- Fix: allow an authenticated school member to insert an audit_logs row,
-- but only one attributed to themselves (user_id must resolve to their own
-- profile) and scoped to their own school (school_id must match
-- current_school_id()) — so a school_admin/teacher can log their own
-- actions but can't forge entries for another user or another school.

CREATE POLICY "school_member_audit_insert" ON audit_logs FOR INSERT
  WITH CHECK (
    school_id = current_school_id()
    AND (
      user_id IS NULL
      OR user_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
    )
  );

-- ============================================================
-- CA-WIZARD | Migration 035 — Staff (school-less) audit inserts
-- ============================================================
-- Migration 010 fixed audit_logs so a school-scoped actor
-- (school_admin, teacher) can log their own actions:
--
--   WITH CHECK (school_id = current_school_id() AND ...)
--
-- That policy was written before group_admin existed (023) and
-- can't cover it: a group_admin has no school_id at all, so both
-- sides of "school_id = current_school_id()" are NULL — and
-- NULL = NULL is never TRUE in SQL, so the check always fails.
-- A group_admin's own actions (and any other school-less staff
-- action) can never satisfy this policy, regardless of what values
-- are passed in.
--
-- Needed now because self-registration audit logging (this
-- migration's companion frontend change) covers both teacher joins
-- (school-scoped, already worked) and staff/group_admin joins
-- (school-less, didn't) — without this, only half of that symmetry
-- would actually work.
-- ============================================================

CREATE POLICY "staff_audit_insert" ON audit_logs FOR INSERT
  WITH CHECK (
    school_id IS NULL
    AND user_id IN (
      SELECT id FROM profiles WHERE user_id = auth.uid() AND school_id IS NULL
    )
  );

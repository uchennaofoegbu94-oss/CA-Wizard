-- ============================================================
-- CA-WIZARD | Migration 045 — Backfill Missing Default Grading System
-- ============================================================
-- Every report card page (get_score_fields callers, BulkReportCardPage,
-- etc.) looks up grade/remark via `grading_systems WHERE is_default =
-- true`. Until now, a newly created grading system was always
-- inserted with is_default = false — becoming default required a
-- separate, easy-to-miss "Set Default" action. A school that created
-- exactly one grading system (the overwhelmingly common case) could
-- fill in every grade boundary and still see "—" for grade/remark on
-- every report card indefinitely, with no error anywhere to surface
-- why. Fixed going forward in GradingPage.tsx (the first system a
-- school creates now auto-defaults); this is the one-time backfill
-- for schools already stuck in that state.
--
-- For a school with exactly one grading system and none marked
-- default, that one system is unambiguously what they meant — mark
-- it default. For a school with MULTIPLE systems and none marked
-- default (a genuinely ambiguous case with no way to know which one
-- was "meant"), the oldest one becomes default — strictly better than
-- leaving every report card blank, and an admin can switch it via
-- "Set Default" if it's the wrong pick.
-- ============================================================

DO $$
DECLARE
  v_school RECORD;
  v_oldest_id UUID;
BEGIN
  FOR v_school IN
    SELECT DISTINCT school_id FROM grading_systems
  LOOP
    -- Skip schools that already have a default set.
    IF EXISTS (SELECT 1 FROM grading_systems WHERE school_id = v_school.school_id AND is_default = TRUE) THEN
      CONTINUE;
    END IF;

    SELECT id INTO v_oldest_id
    FROM grading_systems
    WHERE school_id = v_school.school_id
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_oldest_id IS NOT NULL THEN
      UPDATE grading_systems SET is_default = TRUE WHERE id = v_oldest_id;
    END IF;
  END LOOP;
END $$;

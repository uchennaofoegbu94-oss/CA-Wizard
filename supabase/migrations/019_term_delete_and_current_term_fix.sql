-- ============================================================
-- 019: term deletion + cross-session current-term fix
-- ============================================================
-- Three related bugs reported together:
--
-- 1. Sessions can no longer be deleted in practice, because migration
--    014 made every new session auto-populate with 3 terms, and
--    migration 013 blocks deleting a session that still has terms —
--    but there was never any way to delete a term either. New
--    sessions were quietly becoming permanently undeletable. This is
--    a real regression from 014 interacting with 013, not something
--    that was ever intentional.
--
-- 2. terms.start_date/end_date already existed as columns and the
--    manual "Add Term" form already collects them — but the
--    auto-created terms from migration 014's trigger never got dates
--    set, and there was no edit path for an existing term to add them
--    after the fact.
--
-- 3. A term could be marked "current" independent of whether its
--    parent session was the current session — so a term from a past
--    session could sit there flagged current while a totally
--    different session was also flagged current. Nothing enforced
--    the relationship between the two.

-- ── Fix 1: term deletion, with the same care as session deletion ──

DROP POLICY IF EXISTS "school_member_terms" ON terms;
CREATE POLICY "school_member_terms_rw" ON terms FOR SELECT USING (school_id = current_school_id());
CREATE POLICY "school_member_terms_insert" ON terms FOR INSERT WITH CHECK (school_id = current_school_id());
CREATE POLICY "school_member_terms_update" ON terms FOR UPDATE USING (school_id = current_school_id());
CREATE POLICY "school_admin_terms_delete" ON terms FOR DELETE
  USING (school_id = current_school_id() AND current_user_role() = 'school_admin');

-- A term cascades to student_scores, exam_scores, attendance,
-- affective_scores, psychomotor_scores, comments, and report_snapshots
-- on delete — i.e. deleting a term with any real activity under it
-- means deleting an entire term's worth of academic records, including
-- saved transcript snapshots. Same reasoning as migration 013's
-- session guard: the client can check and disable the button, but this
-- trigger is the actual guarantee. Only an empty, never-used term can
-- be deleted.
CREATE OR REPLACE FUNCTION prevent_unsafe_term_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_has_data BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM student_scores      WHERE term_id = OLD.id
    UNION ALL SELECT 1 FROM exam_scores        WHERE term_id = OLD.id
    UNION ALL SELECT 1 FROM attendance         WHERE term_id = OLD.id
    UNION ALL SELECT 1 FROM affective_scores   WHERE term_id = OLD.id
    UNION ALL SELECT 1 FROM psychomotor_scores WHERE term_id = OLD.id
    UNION ALL SELECT 1 FROM comments           WHERE term_id = OLD.id
    UNION ALL SELECT 1 FROM report_snapshots   WHERE term_id = OLD.id
  ) INTO v_has_data;

  IF v_has_data THEN
    RAISE EXCEPTION 'Cannot delete a term with recorded scores, attendance, comments, or saved snapshots. Those records must be removed first, or leave this term as historical record.';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_unsafe_term_delete ON terms;
CREATE TRIGGER trg_prevent_unsafe_term_delete
  BEFORE DELETE ON terms
  FOR EACH ROW EXECUTE FUNCTION prevent_unsafe_term_delete();

-- ── Fix 3: a term can only be current if its session is current ──
-- (Fix 2 — start/end dates — is a client-side change only, an Edit
-- Term dialog; nothing in the schema needed to change since the
-- columns and their form already existed.)

-- Preventive: block directly setting is_current=true on a term whose
-- session isn't itself current. Covers any insert/update path,
-- including ones that don't go through the app's own mutations.
CREATE OR REPLACE FUNCTION prevent_cross_session_current_term()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.is_current AND NOT EXISTS (
    SELECT 1 FROM sessions WHERE id = NEW.session_id AND is_current = true
  ) THEN
    RAISE EXCEPTION 'A term can only be marked current if its session is also the current session';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_cross_session_current_term ON terms;
CREATE TRIGGER trg_prevent_cross_session_current_term
  BEFORE INSERT OR UPDATE ON terms
  FOR EACH ROW EXECUTE FUNCTION prevent_cross_session_current_term();

-- Corrective: when a session BECOMES current, any term that was
-- current under a DIFFERENT session is now stale — the trigger above
-- only stops new violations, it doesn't retroactively fix state that
-- goes bad because a *different* row (the session) changed out from
-- under it. This clears that staleness the moment it would occur.
CREATE OR REPLACE FUNCTION clear_stale_current_terms()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.is_current AND (TG_OP = 'INSERT' OR OLD.is_current IS DISTINCT FROM true) THEN
    UPDATE terms SET is_current = false
    WHERE school_id = NEW.school_id AND session_id != NEW.id AND is_current = true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clear_stale_current_terms ON sessions;
CREATE TRIGGER trg_clear_stale_current_terms
  AFTER INSERT OR UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION clear_stale_current_terms();

-- Backfill: clean up any bad state that already exists from before
-- this fix — a term marked current whose session isn't.
UPDATE terms SET is_current = false
WHERE is_current = true
  AND session_id NOT IN (SELECT id FROM sessions WHERE is_current = true);

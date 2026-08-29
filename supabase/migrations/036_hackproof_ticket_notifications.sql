-- ============================================================
-- CA-WIZARD | Migration 036 — Hack-proofing: authorize the
--                              caller in notify_ticket_participants
-- ============================================================
-- Found during a deliberate security review, not reported as a bug.
--
-- notify_ticket_participants (027) resolves notification recipients
-- entirely from the TICKET's own data (its school_id/group_id/
-- escalation_level) and never checked who was actually CALLING it.
-- Any authenticated user — any role, any school — could invoke it
-- directly with an arbitrary p_ticket_id belonging to a ticket they
-- have no connection to, plus arbitrary p_title/p_body text, and the
-- function would dutifully deliver that content to the ticket's real
-- submitter and/or handler as an in-app notification. Since it's
-- SECURITY DEFINER, it bypasses the notifications table's RLS by
-- design — which is exactly what makes this a real gap: the
-- function itself was the only thing that could have checked "does
-- this caller have any legitimate relationship to this ticket," and
-- it didn't. This is a spoofing/spam vector: a malicious authenticated
-- user could impersonate a system notification about someone else's
-- ticket with content of their choosing.
--
-- Fix: verify the caller is the ticket's submitter, its current
-- handler (matching the exact same escalation_level logic the
-- support_tickets RLS SELECT/UPDATE policies already use), or
-- super_admin, before doing anything else. An unauthorized call now
-- silently no-ops — same as an invalid claim_invite_code call
-- returning nothing — rather than raising an error that would
-- confirm whether a given ticket_id exists to a caller who
-- shouldn't be able to tell.
-- ============================================================

CREATE OR REPLACE FUNCTION notify_ticket_participants(
  p_ticket_id           UUID,
  p_type                TEXT,
  p_title                TEXT,
  p_body                 TEXT,
  p_link_path             TEXT,
  p_notify_submitter      BOOLEAN DEFAULT FALSE,
  p_notify_current_handler BOOLEAN DEFAULT FALSE,
  p_exclude_profile_id     UUID DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_ticket        support_tickets%ROWTYPE;
  v_caller_id     UUID;
  v_caller_role   user_role;
  v_authorized    BOOLEAN := FALSE;
  v_recipient     UUID;
BEGIN
  SELECT * INTO v_ticket FROM public.support_tickets WHERE id = p_ticket_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_caller_id := current_profile_id();
  v_caller_role := current_user_role();

  IF is_super_admin() THEN
    v_authorized := TRUE;
  ELSIF v_ticket.submitted_by = v_caller_id THEN
    v_authorized := TRUE;
  ELSIF v_caller_role = 'school_admin' AND v_ticket.school_id = current_school_id() THEN
    v_authorized := TRUE;
  ELSIF v_caller_role = 'group_admin' AND v_ticket.group_id = current_group_id() THEN
    v_authorized := TRUE;
  END IF;

  IF NOT v_authorized THEN
    RETURN;
  END IF;

  IF p_notify_submitter AND (p_exclude_profile_id IS NULL OR v_ticket.submitted_by <> p_exclude_profile_id) THEN
    INSERT INTO public.notifications (school_id, recipient_id, type, title, body, link_path)
    VALUES (v_ticket.school_id, v_ticket.submitted_by, p_type, p_title, p_body, p_link_path);
  END IF;

  IF p_notify_current_handler THEN
    IF v_ticket.escalation_level = 'school' THEN
      FOR v_recipient IN
        SELECT id FROM public.profiles
        WHERE role = 'school_admin' AND school_id = v_ticket.school_id
          AND (p_exclude_profile_id IS NULL OR id <> p_exclude_profile_id)
      LOOP
        INSERT INTO public.notifications (school_id, recipient_id, type, title, body, link_path)
        VALUES (v_ticket.school_id, v_recipient, p_type, p_title, p_body, p_link_path);
      END LOOP;

    ELSIF v_ticket.escalation_level = 'group' THEN
      SELECT group_admin_id INTO v_recipient FROM public.admin_groups WHERE id = v_ticket.group_id;
      IF v_recipient IS NOT NULL AND (p_exclude_profile_id IS NULL OR v_recipient <> p_exclude_profile_id) THEN
        INSERT INTO public.notifications (school_id, recipient_id, type, title, body, link_path)
        VALUES (v_ticket.school_id, v_recipient, p_type, p_title, p_body, p_link_path);
      END IF;

    ELSE -- 'platform'
      FOR v_recipient IN
        SELECT id FROM public.profiles
        WHERE role = 'super_admin'
          AND (p_exclude_profile_id IS NULL OR id <> p_exclude_profile_id)
      LOOP
        INSERT INTO public.notifications (school_id, recipient_id, type, title, body, link_path)
        VALUES (v_ticket.school_id, v_recipient, p_type, p_title, p_body, p_link_path);
      END LOOP;
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- GRANT is unchanged from 027 (already TO authenticated) — CREATE OR
-- REPLACE preserves the function's existing grants automatically,
-- listed here only for clarity, not because it needs to be reissued.
GRANT EXECUTE ON FUNCTION notify_ticket_participants TO authenticated;

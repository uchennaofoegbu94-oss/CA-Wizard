-- ============================================================
-- CA-WIZARD | Migration 027 — Ticket notifications
-- ============================================================
-- Closes a gap flagged (not fixed) when support_tickets shipped:
-- no notification fan-out on ticket events. Doing this via plain
-- client-side notifyUser()/notifyManyUsers() calls hits a real RLS
-- wall the announcements fan-out never had to deal with — a
-- school_admin's own ticket needs to notify a super_admin, but the
-- existing "school_member_notifications_insert" policy (012)
-- requires the recipient to belong to the SAME school as the
-- caller, and a super_admin has no school at all. Patching that
-- with more ad-hoc RLS policies (like 024 did for group_admin) gets
-- fragile fast once there are three possible handler tiers
-- (school/group/platform) each needing their own cross-role case.
--
-- Instead: one SECURITY DEFINER function that resolves "who is the
-- current handler of this ticket" server-side and writes the
-- notification rows directly, bypassing RLS the same way
-- is_super_admin()/current_group_id() already do. Callable by any
-- authenticated ticket participant — the function itself decides
-- who gets notified, not the caller.
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
  v_ticket    support_tickets%ROWTYPE;
  v_recipient UUID;
BEGIN
  SELECT * INTO v_ticket FROM public.support_tickets WHERE id = p_ticket_id;
  IF NOT FOUND THEN
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

-- No table-level GRANT needed for the notifications INSERT this
-- performs internally — SECURITY DEFINER already runs as the
-- function owner, which bypasses notifications' RLS the same way
-- every other helper in this schema does. Only EXECUTE needs
-- granting to actual app callers.
GRANT EXECUTE ON FUNCTION notify_ticket_participants TO authenticated;

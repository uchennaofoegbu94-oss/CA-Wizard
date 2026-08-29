-- ============================================================
-- CA-WIZARD | Migration 040 — Early-stage support mode
-- ============================================================
-- Confirmed feasible, no real complications — this slots cleanly
-- into the escalation trigger already built in 023
-- (set_ticket_escalation_level), which is the single place that
-- decides where a new ticket starts. One more condition checked
-- first, same platform_settings singleton pattern already used for
-- maintenance_mode (021) and show_live_counter (030).
--
-- Scope, stated explicitly: this only affects NEW tickets going
-- forward. A ticket already sitting at 'school' or 'group' when the
-- toggle is flipped on does NOT jump to 'platform' retroactively —
-- it keeps following the normal escalation path until someone
-- explicitly escalates it, or a school_admin/group_admin resolves it
-- where it is. Deliberate: silently reassigning a ticket a
-- school_admin is already mid-conversation on would be a more
-- surprising, harder-to-predict behavior than "the toggle affects
-- what's submitted from now on." Flipping the toggle back off simply
-- means the next new ticket follows the normal tiered path again —
-- nothing to undo, since nothing was mutated for existing tickets.
-- ============================================================

ALTER TABLE platform_settings ADD COLUMN all_tickets_to_super_admin BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION set_ticket_escalation_level()
RETURNS TRIGGER AS $$
DECLARE
  v_submitter_role       public.user_role;
  v_group_id             UUID;
  v_route_all_to_super   BOOLEAN;
BEGIN
  SELECT role INTO v_submitter_role FROM public.profiles WHERE id = NEW.submitted_by;
  SELECT group_id INTO v_group_id FROM public.schools WHERE id = NEW.school_id;
  SELECT all_tickets_to_super_admin INTO v_route_all_to_super
  FROM public.platform_settings WHERE id = TRUE;

  NEW.group_id := v_group_id;

  IF v_route_all_to_super THEN
    NEW.escalation_level := 'platform';
  ELSIF v_submitter_role = 'school_admin' THEN
    NEW.escalation_level := 'platform';
  ELSIF v_submitter_role = 'teacher' THEN
    NEW.escalation_level := 'school';
  ELSE
    NEW.escalation_level := 'platform';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

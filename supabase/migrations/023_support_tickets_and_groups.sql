-- ============================================================
-- CA-WIZARD | Migration 023 — Support tickets + group admin
--                              hierarchy
-- ============================================================
-- Requires 022 (adds 'group_admin' to user_role) to have already
-- committed. Do not squash these into one migration — see 022's
-- header comment for why.
--
-- Confirmed design (locked in, see handoff doc):
--  - Group admins are platform staff, NOT school-side accounts.
--    No school_id (same pattern as super_admin). They oversee
--    schools via admin_groups, not by being a school_admin.
--  - Staff onboarding mirrors teacher invites (super admin
--    generates a code, person redeems it via /auth/join).
--  - Ticket routing: teacher's ticket -> school_admin -> (if
--    unresolved) escalate to group_admin (if school is in a
--    group) or straight to super_admin (if not) -> group_admin
--    can escalate to super_admin. A school_admin's own ticket
--    routes directly to super_admin, skipping the group layer.
--  - admin_groups.group_admin_id is a plain reassignable FK
--    ("transferable, determined by superadmin").
--  - Status lifecycle: open -> in_progress ->
--    (waiting_on_requester <-> in_progress) -> resolved ->
--    closed, plus reopened. Priority: low/medium/high/urgent.
--    Category: technical/billing/account/feature_request/other.
-- ============================================================


-- ============================================================
-- CRITICAL FIX — handle_new_user's role whitelist
-- ============================================================
-- handle_new_user() (migration 003) only assigns the role from
-- raw_user_meta_data if it matches the IN list
-- ('super_admin','school_admin','teacher'). 'group_admin' was
-- never added to that list, so a group_admin invite redemption
-- would have silently created a 'teacher' profile instead —
-- caught by cross-checking this migration against migration 003
-- before writing JoinPage's staff-invite handling below.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_role       public.user_role := 'teacher';
  v_role_raw   TEXT;
  v_school_id  UUID := NULL;
  v_school_raw TEXT;
BEGIN
  v_role_raw := NEW.raw_user_meta_data->>'role';
  IF v_role_raw IN ('super_admin', 'school_admin', 'teacher', 'group_admin') THEN
    v_role := v_role_raw::public.user_role;
  END IF;

  v_school_raw := NEW.raw_user_meta_data->>'school_id';
  IF v_school_raw IS NOT NULL AND v_school_raw <> '' THEN
    BEGIN
      v_school_id := v_school_raw::UUID;
      IF NOT EXISTS (SELECT 1 FROM public.schools s WHERE s.id = v_school_id) THEN
        v_school_id := NULL;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_school_id := NULL;
    END;
  END IF;

  -- group_admin (like super_admin) is never school-scoped, regardless
  -- of what metadata was sent — belt and suspenders against a bad
  -- client-side signUp() call accidentally attaching a school_id.
  IF v_role = 'group_admin' THEN
    v_school_id := NULL;
  END IF;

  INSERT INTO public.profiles (user_id, email, first_name, last_name, role, school_id, is_active)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'first_name'), ''), 'User'),
    COALESCE(NULLIF(TRIM(NEW.raw_user_meta_data->>'last_name'), ''), ''),
    v_role,
    v_school_id,
    TRUE
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'handle_new_user failed for %: % (SQLSTATE %)', NEW.email, SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;


-- ============================================================
-- ADMIN GROUPS
-- ============================================================

CREATE TABLE admin_groups (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  group_admin_id  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_admin_groups_group_admin_id ON admin_groups(group_admin_id);

CREATE TRIGGER trg_admin_groups_updated_at
  BEFORE UPDATE ON admin_groups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE schools ADD COLUMN group_id UUID REFERENCES admin_groups(id) ON DELETE SET NULL;
CREATE INDEX idx_schools_group_id ON schools(group_id);


-- ── Helper functions ────────────────────────────────────────
-- current_profile_id(): needed by ticket RLS (submitted_by /
-- sender_id checks) — no equivalent existed before this migration.
CREATE OR REPLACE FUNCTION current_profile_id()
RETURNS UUID AS $$
  SELECT id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp;

-- current_group_id(): the admin_groups row this caller manages, if
-- they're a group_admin. NULL for anyone else (including a
-- group_admin not yet assigned to a group).
CREATE OR REPLACE FUNCTION current_group_id()
RETURNS UUID AS $$
  SELECT id FROM public.admin_groups WHERE group_admin_id = public.current_profile_id() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp;


-- ── RLS: admin_groups ───────────────────────────────────────
ALTER TABLE admin_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_admin_groups" ON admin_groups
  FOR ALL USING (is_super_admin());

CREATE POLICY "group_admin_read_own_group" ON admin_groups
  FOR SELECT USING (group_admin_id = current_profile_id());

GRANT ALL ON admin_groups TO authenticated;

-- Schools RLS already has a blanket "public_read_school_for_invite_check"
-- (migration 005, FOR SELECT USING (TRUE)) which — by design, for the
-- invite-verification flow — already covers group_admin reading any
-- school, including ones in their group. No additional schools SELECT
-- policy is needed. Only super_admin has UPDATE on schools
-- (super_admin_all_schools, FOR ALL), which already covers assigning
-- schools to a group from GroupsPage.


-- ============================================================
-- STAFF INVITES — extend invite_codes for group_admin onboarding
-- ============================================================
-- Staff (group_admin) invites are generated by a super admin and
-- carry no school_id — mirrors the teacher invite flow exactly,
-- just without a school attached. school_id was NOT NULL before;
-- relax it and add target_role so JoinPage.tsx can tell which role
-- to grant on redemption instead of hardcoding 'teacher'.

ALTER TABLE invite_codes ALTER COLUMN school_id DROP NOT NULL;
ALTER TABLE invite_codes ADD COLUMN target_role user_role NOT NULL DEFAULT 'teacher';

-- A staff (school_id IS NULL) invite only ever makes sense for
-- group_admin right now; a school-scoped invite should never target
-- group_admin. Keeps the two onboarding paths from being mixed up
-- by a future bug.
ALTER TABLE invite_codes ADD CONSTRAINT invite_codes_target_role_school_match CHECK (
  (school_id IS NULL AND target_role = 'group_admin')
  OR (school_id IS NOT NULL AND target_role <> 'group_admin')
);

-- Existing RLS is unaffected:
--   super_admin_invite_codes (FOR ALL USING is_super_admin()) already
--   covers super admin generating staff invites with school_id NULL.
--   school_admin_invite_codes filters on school_id = current_school_id(),
--   which a NULL school_id row will never match — school admins simply
--   won't see staff invites, which is correct.
--   public_read_invite_code (FOR SELECT USING TRUE) still lets JoinPage
--   verify a staff code before an account exists, same as today.


-- ============================================================
-- SUPPORT TICKETS
-- ============================================================

CREATE TYPE ticket_status AS ENUM (
  'open', 'in_progress', 'waiting_on_requester', 'resolved', 'closed', 'reopened'
);
CREATE TYPE ticket_priority AS ENUM ('low', 'medium', 'high', 'urgent');
CREATE TYPE ticket_category AS ENUM (
  'technical', 'billing', 'account', 'feature_request', 'other'
);
-- Who currently owns/handles the ticket, not just how far it has
-- travelled — used directly by the UPDATE RLS policy below to decide
-- who may currently act on it.
CREATE TYPE ticket_escalation_level AS ENUM ('school', 'group', 'platform');

CREATE TABLE support_tickets (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  submitted_by      UUID NOT NULL REFERENCES profiles(id),
  school_id         UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  group_id          UUID REFERENCES admin_groups(id) ON DELETE SET NULL,
  subject           TEXT NOT NULL,
  description       TEXT NOT NULL,
  status            ticket_status NOT NULL DEFAULT 'open',
  priority          ticket_priority NOT NULL DEFAULT 'medium',
  category          ticket_category NOT NULL DEFAULT 'other',
  escalation_level  ticket_escalation_level NOT NULL DEFAULT 'school',
  assigned_to       UUID REFERENCES profiles(id) ON DELETE SET NULL,
  resolved_at       TIMESTAMPTZ,
  closed_at         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- escalation_level can only be 'group' if the ticket actually has a
  -- group — otherwise there is nothing for a group_admin to see.
  CONSTRAINT support_tickets_group_escalation_requires_group
    CHECK (escalation_level <> 'group' OR group_id IS NOT NULL)
);

CREATE INDEX idx_support_tickets_submitted_by ON support_tickets(submitted_by);
CREATE INDEX idx_support_tickets_school_id    ON support_tickets(school_id);
CREATE INDEX idx_support_tickets_group_id     ON support_tickets(group_id);
CREATE INDEX idx_support_tickets_status       ON support_tickets(status);
CREATE INDEX idx_support_tickets_escalation   ON support_tickets(escalation_level);

CREATE TRIGGER trg_support_tickets_updated_at
  BEFORE UPDATE ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


CREATE TABLE ticket_messages (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id   UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  sender_id   UUID NOT NULL REFERENCES profiles(id),
  message     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ticket_messages_ticket_id ON ticket_messages(ticket_id);


-- ── Escalation trigger ──────────────────────────────────────
-- Sets escalation_level (and denormalizes group_id from the
-- submitter's school) at INSERT time. My own design, not yet
-- explicitly re-confirmed by the user — flagged in the handoff doc.
--   school_admin's own ticket -> 'platform' (straight to super admin,
--     skipping the group layer entirely, per confirmed spec)
--   teacher's ticket          -> 'school' (starts with school_admin)
--   anything else (group_admin/super_admin filing one, edge case
--     outside current scope) -> 'platform'
CREATE OR REPLACE FUNCTION set_ticket_escalation_level()
RETURNS TRIGGER AS $$
DECLARE
  v_submitter_role public.user_role;
  v_group_id       UUID;
BEGIN
  SELECT role INTO v_submitter_role FROM public.profiles WHERE id = NEW.submitted_by;
  SELECT group_id INTO v_group_id FROM public.schools WHERE id = NEW.school_id;

  NEW.group_id := v_group_id;

  IF v_submitter_role = 'school_admin' THEN
    NEW.escalation_level := 'platform';
  ELSIF v_submitter_role = 'teacher' THEN
    NEW.escalation_level := 'school';
  ELSE
    NEW.escalation_level := 'platform';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE TRIGGER trg_set_ticket_escalation_level
  BEFORE INSERT ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION set_ticket_escalation_level();


-- ── RLS: support_tickets ────────────────────────────────────
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;

-- Submitter always sees their own ticket, regardless of who currently
-- holds it or what school/group filters would otherwise apply.
CREATE POLICY "ticket_submitter_read" ON support_tickets
  FOR SELECT USING (submitted_by = current_profile_id());

CREATE POLICY "ticket_school_admin_read" ON support_tickets
  FOR SELECT USING (current_user_role() = 'school_admin' AND school_id = current_school_id());

CREATE POLICY "ticket_group_admin_read" ON support_tickets
  FOR SELECT USING (current_user_role() = 'group_admin' AND group_id = current_group_id());

CREATE POLICY "ticket_super_admin_read" ON support_tickets
  FOR SELECT USING (is_super_admin());

-- Only a teacher or school_admin can open a ticket, and only for
-- their own school, as themselves.
CREATE POLICY "ticket_create" ON support_tickets
  FOR INSERT WITH CHECK (
    submitted_by = current_profile_id()
    AND school_id = current_school_id()
    AND current_user_role() IN ('teacher', 'school_admin')
  );

-- UPDATE: USING (pre-image) restricts who may act on a ticket to
-- whoever currently holds it per escalation_level — a school_admin
-- loses write access the moment they escalate past 'school', same
-- for a group_admin past 'group'. WITH CHECK (post-image) only
-- re-confirms the row still belongs to their school/group, which is
-- deliberately looser so the same UPDATE that performs the escalation
-- (moving escalation_level forward) is itself allowed.
CREATE POLICY "ticket_handler_update" ON support_tickets
  FOR UPDATE
  USING (
    is_super_admin()
    OR (current_user_role() = 'group_admin' AND group_id = current_group_id() AND escalation_level = 'group')
    OR (current_user_role() = 'school_admin' AND school_id = current_school_id() AND escalation_level = 'school')
  )
  WITH CHECK (
    is_super_admin()
    OR (current_user_role() = 'group_admin' AND group_id = current_group_id())
    OR (current_user_role() = 'school_admin' AND school_id = current_school_id())
  );

GRANT ALL ON support_tickets TO authenticated;


-- ── RLS: ticket_messages ────────────────────────────────────
-- Deliberately broader than the ticket UPDATE policy above — anyone
-- who can see the ticket (submitter, or a school_admin/group_admin/
-- super_admin scoped to it) can read and post messages, even after
-- the ticket has escalated past their level. Escalation only gates
-- who can change ticket STATE (status/priority/escalation); it
-- shouldn't cut a school_admin out of a conversation they started
-- on their own school's ticket.
ALTER TABLE ticket_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ticket_messages_read" ON ticket_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.support_tickets t
      WHERE t.id = ticket_messages.ticket_id
        AND (
          t.submitted_by = current_profile_id()
          OR is_super_admin()
          OR (current_user_role() = 'school_admin' AND t.school_id = current_school_id())
          OR (current_user_role() = 'group_admin' AND t.group_id = current_group_id())
        )
    )
  );

CREATE POLICY "ticket_messages_create" ON ticket_messages
  FOR INSERT WITH CHECK (
    sender_id = current_profile_id()
    AND EXISTS (
      SELECT 1 FROM public.support_tickets t
      WHERE t.id = ticket_messages.ticket_id
        AND (
          t.submitted_by = current_profile_id()
          OR is_super_admin()
          OR (current_user_role() = 'school_admin' AND t.school_id = current_school_id())
          OR (current_user_role() = 'group_admin' AND t.group_id = current_group_id())
        )
    )
  );

GRANT ALL ON ticket_messages TO authenticated;

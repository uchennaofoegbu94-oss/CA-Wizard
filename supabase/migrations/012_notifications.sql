-- ============================================================
-- 012: notifications
-- ============================================================
-- In-app notifications, fan-out model: one row per recipient
-- (simpler to query/mark-read per-user than a shared row + a
-- separate read-state join table, and no school in this system
-- is anywhere near the scale where that stops being cheap).
--
-- Email readiness, without committing to a provider yet:
-- requires_email + email_sent_at is a plain outbox pattern. A
-- notification that needs to reach someone who's logged out
-- (school approved/suspended/reactivated) is inserted with
-- requires_email = true and email_sent_at = null. Whatever email
-- sending gets built later — Supabase Edge Function on a cron,
-- a Postgres trigger calling out via pg_net, an external worker —
-- it's just:
--   SELECT n.*, p.email FROM notifications n JOIN profiles p ON p.id = n.recipient_id
--   WHERE n.requires_email AND n.email_sent_at IS NULL ORDER BY n.created_at;
-- ...send, then UPDATE ... SET email_sent_at = now(). No schema
-- change needed to wire a real provider in later.
--
-- RLS is designed up front this time, not discovered missing
-- after the fact (see migration 010's postmortem on audit_logs):
-- notifications are frequently written by someone OTHER than the
-- recipient (a school_admin locking a term writes rows for every
-- teacher in the school), so the insert policy has to allow that
-- cross-user, same-school write while still preventing a school
-- member from spamming another school's users.

CREATE TABLE notifications (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id      UUID REFERENCES schools(id) ON DELETE CASCADE,
  recipient_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type           TEXT NOT NULL,
  title          TEXT NOT NULL,
  body           TEXT,
  link_path      TEXT,
  is_read        BOOLEAN NOT NULL DEFAULT FALSE,
  requires_email BOOLEAN NOT NULL DEFAULT FALSE,
  email_sent_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_recipient    ON notifications(recipient_id, is_read, created_at DESC);
CREATE INDEX idx_notifications_school       ON notifications(school_id);
CREATE INDEX idx_notifications_email_queue  ON notifications(requires_email, email_sent_at)
  WHERE requires_email AND email_sent_at IS NULL;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Super admin: full access — needed both to manage notifications
-- generally and because super-admin actions (approving a school)
-- write notifications for a school_admin who isn't "in" any school
-- the actor belongs to.
CREATE POLICY "super_admin_notifications" ON notifications FOR ALL
  USING (is_super_admin());

-- Any authenticated user can read and mark-read their own notifications.
CREATE POLICY "own_notifications_select" ON notifications FOR SELECT
  USING (recipient_id IN (SELECT id FROM profiles WHERE user_id = auth.uid()));

CREATE POLICY "own_notifications_update" ON notifications FOR UPDATE
  USING (recipient_id IN (SELECT id FROM profiles WHERE user_id = auth.uid()));

-- A school_admin (or, in future, a teacher) can insert a notification
-- for anyone — including someone other than themselves — as long as
-- both the notification's school_id and the recipient's own school_id
-- match the caller's own current_school_id(). This is what makes
-- "notify every teacher when a term is locked" possible without
-- opening the door to notifying users in a different school.
CREATE POLICY "school_member_notifications_insert" ON notifications FOR INSERT
  WITH CHECK (
    school_id = current_school_id()
    AND recipient_id IN (SELECT id FROM profiles WHERE school_id = current_school_id())
  );

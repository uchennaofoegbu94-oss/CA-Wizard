-- ============================================================
-- CA-WIZARD | Migration 024 — Announcements
-- ============================================================
-- Tier 3, Item #3. Depends on migration 023 (admin_groups,
-- current_group_id(), current_profile_id()) — explicitly next
-- per the handoff doc, since a group_admin's send-scope is
-- "schools in my group", which only exists as of 023.
--
-- Confirmed design: super_admin or group_admin -> school_admin,
-- one-way only (no reply/thread — that's what support_tickets is
-- for). A super_admin can target all schools, a single group, or
-- a hand-picked set of schools. A group_admin can only target
-- schools inside their own group.
--
-- Targeting model: announcement_targets holds one row per
-- targeted school, decided at send time. "All schools" is a
-- snapshot (one row per school that existed when it was sent),
-- same tradeoff already made for support_tickets.group_id — a
-- school created afterward simply wasn't there to target.
-- ============================================================

CREATE TABLE announcements (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_by      UUID NOT NULL REFERENCES profiles(id),
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  -- Denormalized, display-only summary of who this went to
  -- ("All Schools" / "My Group" / "12 Schools") — never used for
  -- access control, only so the sender's list view doesn't need to
  -- COUNT(announcement_targets) on every row.
  audience_label  TEXT NOT NULL DEFAULT 'Custom',
  pinned          BOOLEAN NOT NULL DEFAULT FALSE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_announcements_created_by ON announcements(created_by);

CREATE TRIGGER trg_announcements_updated_at
  BEFORE UPDATE ON announcements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


CREATE TABLE announcement_targets (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  announcement_id  UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  school_id        UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (announcement_id, school_id)
);

CREATE INDEX idx_announcement_targets_school ON announcement_targets(school_id);
CREATE INDEX idx_announcement_targets_announcement ON announcement_targets(announcement_id);


CREATE TABLE announcement_reads (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  announcement_id  UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  profile_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  read_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (announcement_id, profile_id)
);

CREATE INDEX idx_announcement_reads_profile ON announcement_reads(profile_id);


-- ── RLS: announcements ──────────────────────────────────────
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "announcements_super_admin" ON announcements
  FOR ALL USING (is_super_admin());

-- A group_admin manages (sees, edits, archives) only what they sent.
CREATE POLICY "announcements_group_admin_own" ON announcements
  FOR ALL USING (current_user_role() = 'group_admin' AND created_by = current_profile_id());

-- A school_admin sees anything currently active that was targeted at
-- their school — read-only, hence FOR SELECT only, nothing else.
CREATE POLICY "announcements_school_admin_read" ON announcements
  FOR SELECT USING (
    current_user_role() = 'school_admin'
    AND is_active
    AND EXISTS (
      SELECT 1 FROM announcement_targets t
      WHERE t.announcement_id = announcements.id AND t.school_id = current_school_id()
    )
  );

GRANT ALL ON announcements TO authenticated;


-- ── RLS: announcement_targets ───────────────────────────────
ALTER TABLE announcement_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "announcement_targets_super_admin" ON announcement_targets
  FOR ALL USING (is_super_admin());

CREATE POLICY "announcement_targets_sender_read" ON announcement_targets
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM announcements a
      WHERE a.id = announcement_targets.announcement_id AND a.created_by = current_profile_id()
    )
  );

CREATE POLICY "announcement_targets_school_admin_read" ON announcement_targets
  FOR SELECT USING (current_user_role() = 'school_admin' AND school_id = current_school_id());

-- A group_admin may only target schools that are actually in their
-- own group — the one place this migration enforces the "group_admin
-- can only reach their own group" rule from the confirmed spec.
CREATE POLICY "announcement_targets_group_admin_insert" ON announcement_targets
  FOR INSERT WITH CHECK (
    current_user_role() = 'group_admin'
    AND EXISTS (
      SELECT 1 FROM announcements a
      WHERE a.id = announcement_targets.announcement_id AND a.created_by = current_profile_id()
    )
    AND EXISTS (
      SELECT 1 FROM schools s
      WHERE s.id = announcement_targets.school_id AND s.group_id = current_group_id()
    )
  );

CREATE POLICY "announcement_targets_group_admin_delete" ON announcement_targets
  FOR DELETE USING (
    current_user_role() = 'group_admin'
    AND EXISTS (
      SELECT 1 FROM announcements a
      WHERE a.id = announcement_targets.announcement_id AND a.created_by = current_profile_id()
    )
  );

GRANT ALL ON announcement_targets TO authenticated;


-- ── RLS: announcement_reads ──────────────────────────────────
ALTER TABLE announcement_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "announcement_reads_own" ON announcement_reads
  FOR SELECT USING (profile_id = current_profile_id());

-- A school_admin can only mark as read an announcement that was
-- actually targeted at their own school — stops a school_admin from
-- generating read receipts on something never sent to them.
CREATE POLICY "announcement_reads_mark_own" ON announcement_reads
  FOR INSERT WITH CHECK (
    profile_id = current_profile_id()
    AND EXISTS (
      SELECT 1 FROM announcement_targets t
      WHERE t.announcement_id = announcement_reads.announcement_id AND t.school_id = current_school_id()
    )
  );

-- Sender (or super_admin) can see who has read their own announcement.
CREATE POLICY "announcement_reads_sender_read" ON announcement_reads
  FOR SELECT USING (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM announcements a
      WHERE a.id = announcement_reads.announcement_id AND a.created_by = current_profile_id()
    )
  );

GRANT ALL ON announcement_reads TO authenticated;


-- ============================================================
-- Extend notifications RLS so a group_admin can fan out an
-- in-app notification when they publish an announcement.
-- ============================================================
-- The existing "school_member_notifications_insert" policy (012)
-- only lets a caller with a current_school_id() write notifications
-- for their own school — a group_admin has no school_id at all
-- (same as super_admin), so without this they'd silently be unable
-- to notify anyone despite RLS letting them create the announcement
-- itself. Scoped tightly: only schools in the caller's own group,
-- only recipients who actually belong to that school.
CREATE POLICY "group_admin_notifications_insert" ON notifications
  FOR INSERT WITH CHECK (
    current_user_role() = 'group_admin'
    AND EXISTS (SELECT 1 FROM schools s WHERE s.id = notifications.school_id AND s.group_id = current_group_id())
    AND recipient_id IN (SELECT id FROM profiles WHERE school_id = notifications.school_id)
  );

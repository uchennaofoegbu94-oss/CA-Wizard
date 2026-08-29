-- ============================================================
-- CA-WIZARD | Migration 026 — Fix announcement RLS recursion
-- ============================================================
-- Bug: "infinite recursion detected in policy for relation
-- announcements", surfaced when composing an announcement in the
-- app. Root cause — migration 024 wrote two policies that query
-- each other directly:
--
--   announcements.announcements_school_admin_read
--     -> EXISTS (SELECT ... FROM announcement_targets ...)
--   announcement_targets.announcement_targets_sender_read /
--   announcement_targets_group_admin_insert
--     -> EXISTS (SELECT ... FROM announcements ...)
--
-- Evaluating either table's RLS pulls in the other table's RLS,
-- which pulls the first table's RLS again. Every other cross-table
-- check in this schema (is_super_admin(), current_school_id(),
-- current_group_id()) goes through a SECURITY DEFINER helper
-- function specifically to avoid this — those functions bypass RLS
-- entirely on the table they query, so they can never re-trigger
-- the policy that called them. 024 is the one place that pattern
-- was skipped. This migration replaces the two raw cross-table
-- EXISTS subqueries with the same kind of helper.
-- ============================================================

-- Bypasses RLS on announcements (SECURITY DEFINER, same as
-- is_super_admin()/current_group_id()) — this is what breaks the
-- cycle. Calling this from an announcement_targets policy can never
-- re-trigger announcements' own policies.
CREATE OR REPLACE FUNCTION is_announcement_owner(p_announcement_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.announcements a
    WHERE a.id = p_announcement_id AND a.created_by = public.current_profile_id()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp;

-- Bypasses RLS on announcement_targets — the other half of the
-- cycle. Calling this from an announcements policy can never
-- re-trigger announcement_targets' own policies.
CREATE OR REPLACE FUNCTION is_announcement_targeted_at_school(p_announcement_id UUID, p_school_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.announcement_targets t
    WHERE t.announcement_id = p_announcement_id AND t.school_id = p_school_id
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp;


-- ── announcements ────────────────────────────────────────────
DROP POLICY IF EXISTS "announcements_school_admin_read" ON announcements;
CREATE POLICY "announcements_school_admin_read" ON announcements
  FOR SELECT USING (
    current_user_role() = 'school_admin'
    AND is_active
    AND is_announcement_targeted_at_school(id, current_school_id())
  );


-- ── announcement_targets ─────────────────────────────────────
DROP POLICY IF EXISTS "announcement_targets_sender_read" ON announcement_targets;
CREATE POLICY "announcement_targets_sender_read" ON announcement_targets
  FOR SELECT USING (is_announcement_owner(announcement_id));

DROP POLICY IF EXISTS "announcement_targets_group_admin_insert" ON announcement_targets;
CREATE POLICY "announcement_targets_group_admin_insert" ON announcement_targets
  FOR INSERT WITH CHECK (
    current_user_role() = 'group_admin'
    AND is_announcement_owner(announcement_id)
    AND EXISTS (
      SELECT 1 FROM schools s
      WHERE s.id = announcement_targets.school_id AND s.group_id = current_group_id()
    )
  );

DROP POLICY IF EXISTS "announcement_targets_group_admin_delete" ON announcement_targets;
CREATE POLICY "announcement_targets_group_admin_delete" ON announcement_targets
  FOR DELETE USING (
    current_user_role() = 'group_admin'
    AND is_announcement_owner(announcement_id)
  );


-- ── announcement_reads ───────────────────────────────────────
-- Not part of the cycle (announcement_targets' policies never query
-- announcement_reads back), so this one was never broken — swapped
-- to the helper anyway for consistency and to avoid re-running
-- announcements' full policy chain on every read-receipt check.
DROP POLICY IF EXISTS "announcement_reads_sender_read" ON announcement_reads;
CREATE POLICY "announcement_reads_sender_read" ON announcement_reads
  FOR SELECT USING (
    is_super_admin()
    OR is_announcement_owner(announcement_id)
  );

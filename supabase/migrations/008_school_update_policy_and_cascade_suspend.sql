-- ============================================================
-- CA-WIZARD | Migration 008 — Fix schools UPDATE RLS gap +
--                              cascading suspend/reactivate
-- ============================================================

-- ── Root cause of branding/settings silently not saving ──────
-- schools table has only ever had a FOR SELECT policy for
-- school_admin (school_admin_own_school). Every UPDATE from
-- Settings — including this batch's logo/watermark/color saves —
-- has been silently rejected by Postgres RLS (default-deny: no
-- policy for a command means that command is blocked entirely).
CREATE POLICY "school_admin_update_own_school" ON schools
  FOR UPDATE
  USING (id = current_school_id() AND current_user_role() = 'school_admin')
  WITH CHECK (id = current_school_id());


-- ── Cascading suspend/reactivate ──────────────────────────────
-- Suspending a school_admin should suspend every teacher at that
-- school; reactivating should reactivate them too. Doing this as
-- one atomic SECURITY DEFINER function (rather than two separate
-- client-side calls) guarantees it can't partially fail, and lets
-- the Super Admin UI trust the result without a second query to
-- "check if it actually stuck".
CREATE OR REPLACE FUNCTION set_school_admin_status(
  p_profile_id UUID,
  p_is_active  BOOLEAN
)
RETURNS TABLE(affected_count INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_school_id UUID;
  v_role      public.user_role;
  v_count     INT := 0;
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Only a Super Admin can change account status';
  END IF;

  SELECT school_id, role INTO v_school_id, v_role
  FROM public.profiles WHERE id = p_profile_id;

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  -- Always update the target profile itself
  UPDATE public.profiles SET is_active = p_is_active WHERE id = p_profile_id;
  v_count := v_count + 1;

  -- Cascade to every teacher at the same school ONLY when the
  -- target is a school_admin — suspending/reactivating an
  -- individual teacher never cascades to anyone else.
  IF v_role = 'school_admin' AND v_school_id IS NOT NULL THEN
    UPDATE public.profiles
    SET is_active = p_is_active
    WHERE school_id = v_school_id AND role = 'teacher';
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_count := v_count + 1; -- + the admin row itself
  END IF;

  RETURN QUERY SELECT v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION set_school_admin_status TO authenticated;

-- ============================================================
-- 050: Transferable school_admin role
-- ============================================================
-- Mirrors archive_teacher (016) deliberately: the old admin's profile
-- stays (past actions/audit entries still show who did them),
-- is_active flips to false (same "archived" mechanic already used
-- for a departed teacher — blocks login app-wide via RequireAuth),
-- and it's a SECURITY DEFINER RPC rather than plain client updates
-- for the same reason archive_teacher/set_school_admin_status are:
-- profiles RLS doesn't let a school_admin UPDATE another profile's
-- role directly.
--
-- Callable by the CURRENT school_admin of that school, or by
-- super_admin (per spec: "school admin role transferable both by
-- superadmin and by current admin"). The target must already be an
-- active teacher at the same school — this is a hand-off between two
-- specific people, not a way to install an outside/unaffiliated user
-- as admin.
--
-- A school having briefly zero OR more than one active school_admin
-- mid-transaction is never observable outside this function — both
-- the promotion and the old admin's deactivation happen in the same
-- transaction.
CREATE OR REPLACE FUNCTION transfer_school_admin(p_school_id UUID, p_new_admin_teacher_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_profile_id UUID;
  v_target_school_id  UUID;
  v_target_role        user_role;
  v_target_is_active    BOOLEAN;
BEGIN
  IF NOT (
    is_super_admin()
    OR (current_school_id() = p_school_id AND current_user_role() = 'school_admin')
  ) THEN
    RAISE EXCEPTION 'Not authorized to transfer the admin role for this school';
  END IF;

  SELECT school_id, role, is_active INTO v_target_school_id, v_target_role, v_target_is_active
  FROM profiles WHERE id = p_new_admin_teacher_id;

  IF v_target_school_id IS NULL OR v_target_school_id IS DISTINCT FROM p_school_id THEN
    RAISE EXCEPTION 'Target is not a member of this school';
  END IF;
  IF v_target_role <> 'teacher' THEN
    RAISE EXCEPTION 'Target must be an active teacher at this school';
  END IF;
  IF NOT COALESCE(v_target_is_active, FALSE) THEN
    RAISE EXCEPTION 'Target must be an active teacher at this school';
  END IF;

  SELECT id INTO v_caller_profile_id FROM profiles WHERE user_id = auth.uid();

  -- Promote the new admin.
  UPDATE profiles SET role = 'school_admin', updated_at = now() WHERE id = p_new_admin_teacher_id;

  -- Any section_admin grants the new admin held are now redundant
  -- (a full school_admin already has everything those toggles grant
  -- and more) — cleared so the Section Admins list doesn't keep
  -- showing someone who is no longer a plain teacher.
  DELETE FROM section_admins WHERE teacher_id = p_new_admin_teacher_id;

  -- Deactivate every other currently-active school_admin at this
  -- school (ordinarily exactly one — the caller, if they're the
  -- current admin; loops over all as a defensive measure in case of
  -- a stray duplicate) — same is_active=false "archived" mechanic as
  -- archive_teacher, not a role change or a hard delete.
  UPDATE profiles
  SET is_active = false, updated_at = now()
  WHERE school_id = p_school_id
    AND role = 'school_admin'
    AND is_active = true
    AND id <> p_new_admin_teacher_id;
END;
$$;

GRANT EXECUTE ON FUNCTION transfer_school_admin TO authenticated;

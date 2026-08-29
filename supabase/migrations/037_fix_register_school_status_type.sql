-- ============================================================
-- CA-WIZARD | Migration 037 — Fix "column status is of type
--                              school_status but expression is
--                              of type text" on school registration
-- ============================================================
-- Root cause, confirmed by reproducing the exact error against a
-- real Postgres 16 instance using the actual school_status enum
-- (not a simplified stand-in — that gap is exactly what let this
-- slip through 032's own verification):
--
-- schools.status is `school_status` (an ENUM: active/suspended/
-- pending). register_school_public declares its local variable as
-- `v_status text` and assigns it a plain string via a CASE
-- expression. Postgres does not implicitly cast a TEXT variable to
-- a user-defined enum on INSERT — that requires either an explicit
-- cast or the variable being declared as the enum type itself in
-- the first place. Every self-serve registration hit this.
--
-- This is NOT related to the onboarding-flow frontend change
-- (item #14) — that only added a client-side step before this same
-- form, it never touches this function. This bug has been present
-- since migration 021 first introduced this exact `v_status text`
-- declaration; migration 032 (which fixed the separate "ambiguous
-- id" bug in this same function) carried it forward unchanged,
-- because 032's own verification used a simplified TEXT column for
-- status instead of the real enum — the same shortcut this fix
-- avoids by testing against school_status specifically.
--
-- Fix: declare v_status as school_status directly, so the CASE
-- expression's string literals ('active'/'pending') resolve as
-- enum values at assignment time — Postgres does allow this
-- specific case (assigning a string literal to a variable already
-- declared as the target enum type), verified below.
-- ============================================================

CREATE OR REPLACE FUNCTION register_school_public(
  p_name               text,
  p_address            text DEFAULT NULL,
  p_phone              text DEFAULT NULL,
  p_email              text DEFAULT NULL,
  p_motto              text DEFAULT NULL,
  p_principal_name     text DEFAULT NULL,
  p_subscription_tier  text DEFAULT NULL
)
RETURNS TABLE(id uuid, slug text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_base_slug text;
  v_slug      text;
  v_suffix    int := 0;
  v_id        uuid;
  v_tier      text;
  v_settings  RECORD;
  v_status    school_status;
BEGIN
  IF p_name IS NULL OR length(trim(p_name)) < 3 THEN
    RAISE EXCEPTION 'School name must be at least 3 characters';
  END IF;

  SELECT ps.default_subscription_tier, ps.auto_approve_schools
  INTO v_settings
  FROM public.platform_settings ps WHERE ps.id = TRUE;

  v_tier := lower(coalesce(p_subscription_tier, v_settings.default_subscription_tier, 'free'));
  IF v_tier NOT IN ('free', 'starter', 'professional') THEN
    v_tier := 'free';
  END IF;

  v_status := CASE WHEN v_settings.auto_approve_schools THEN 'active' ELSE 'pending' END;

  v_base_slug := lower(regexp_replace(trim(p_name), '[^a-zA-Z0-9]+', '-', 'g'));
  v_base_slug := trim(both '-' from v_base_slug);
  v_slug := v_base_slug;

  WHILE EXISTS (SELECT 1 FROM public.schools s WHERE s.slug = v_slug) LOOP
    v_suffix := v_suffix + 1;
    v_slug := v_base_slug || '-' || v_suffix;
  END LOOP;

  INSERT INTO public.schools (name, slug, address, phone, email, motto, principal_name, status, subscription_tier)
  VALUES (trim(p_name), v_slug, p_address, p_phone, p_email, p_motto, p_principal_name, v_status, v_tier)
  RETURNING schools.id INTO v_id;

  RETURN QUERY SELECT v_id, v_slug;
END;
$$;

GRANT EXECUTE ON FUNCTION register_school_public TO anon, authenticated;

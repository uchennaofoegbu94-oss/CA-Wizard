-- ============================================================
-- CA-WIZARD | Migration 032 — Fix "column reference id is
--                              ambiguous" on school registration
-- ============================================================
-- Root cause, confirmed by reproducing the exact error against a
-- real Postgres 16 instance before writing this fix:
--
-- register_school_public is declared RETURNS TABLE(id uuid, slug
-- text). In a LANGUAGE plpgsql function, RETURNS TABLE(...) OUT
-- parameters become real variables in scope for the entire function
-- body — so the name "id" is simultaneously a plpgsql variable AND,
-- inside the platform_settings lookup added by migration 021, an
-- unqualified reference to platform_settings.id:
--
--   SELECT default_subscription_tier, auto_approve_schools
--   INTO v_settings
--   FROM platform_settings WHERE id = TRUE;
--
-- Postgres can't tell whether "id" means the OUT parameter or the
-- table column, and raises exactly the error from the screenshot:
-- "column reference \"id\" is ambiguous".
--
-- This is a regression, not a new bug: migration 003's whole purpose
-- was fixing this exact class of collision (there, for "slug") by
-- aliasing every table reference. Migration 021 rewrote the
-- function to add the platform_settings lookup and reintroduced an
-- unqualified reference without carrying that discipline forward.
-- LANGUAGE sql functions (get_maintenance_status, get_platform_stats)
-- don't have this problem — OUT-parameter shadowing is specific to
-- plpgsql — so nothing else in the schema needed auditing beyond
-- this one function; confirmed by checking every other RETURNS
-- TABLE(...) plpgsql function in the schema for a matching name.
--
-- Fix: alias the table and qualify the column, exactly like 003
-- already did for "slug" three lines below this one.
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
  v_status    text;
BEGIN
  IF p_name IS NULL OR length(trim(p_name)) < 3 THEN
    RAISE EXCEPTION 'School name must be at least 3 characters';
  END IF;

  -- Aliased + qualified ("ps.id") so it can never collide with this
  -- function's own "id" OUT parameter — same fix migration 003
  -- already applied to schools.slug below.
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

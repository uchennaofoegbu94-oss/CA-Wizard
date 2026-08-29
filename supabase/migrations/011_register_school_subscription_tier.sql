-- ============================================================
-- 011: capture chosen plan at self-serve registration
-- ============================================================
-- The new landing page's pricing section links "Get Started" /
-- "Start Free Trial" straight into RegisterSchoolPage with
-- ?plan=starter / ?plan=professional in the URL. Previously
-- register_school_public() hardcoded subscription_tier to 'free'
-- with no way to record which plan the school actually picked.
--
-- p_subscription_tier defaults to 'free' so any existing caller
-- that doesn't pass it keeps working exactly as before. Validated
-- against a fixed whitelist rather than a CHECK constraint on the
-- column itself, since 'enterprise' is deliberately NOT self-serve
-- (that flow is "Contact Sales", not this RPC) and super admins
-- may still need to set arbitrary tiers by hand later.

-- Must DROP the old signature first: adding a parameter changes the
-- function's identity as far as Postgres is concerned, so a plain
-- CREATE OR REPLACE would leave both the old 6-arg and new 7-arg
-- versions installed as overloads — which breaks PostgREST's RPC
-- resolution (Supabase calls functions by name + named params, and
-- an ambiguous overload set causes "could not choose the best
-- candidate function" errors from the client).
DROP FUNCTION IF EXISTS register_school_public(text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION register_school_public(
  p_name               text,
  p_address            text DEFAULT NULL,
  p_phone              text DEFAULT NULL,
  p_email              text DEFAULT NULL,
  p_motto              text DEFAULT NULL,
  p_principal_name     text DEFAULT NULL,
  p_subscription_tier  text DEFAULT 'free'
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
BEGIN
  IF p_name IS NULL OR length(trim(p_name)) < 3 THEN
    RAISE EXCEPTION 'School name must be at least 3 characters';
  END IF;

  -- Self-serve registration only ever creates free/starter/professional
  -- schools — enterprise is sales-assisted (Contact Sales), and anything
  -- unrecognized silently falls back to 'free' rather than erroring, so
  -- a malformed/forged query param can't block signup.
  v_tier := lower(coalesce(p_subscription_tier, 'free'));
  IF v_tier NOT IN ('free', 'starter', 'professional') THEN
    v_tier := 'free';
  END IF;

  v_base_slug := lower(regexp_replace(trim(p_name), '[^a-zA-Z0-9]+', '-', 'g'));
  v_base_slug := trim(both '-' from v_base_slug);
  v_slug := v_base_slug;

  WHILE EXISTS (SELECT 1 FROM public.schools s WHERE s.slug = v_slug) LOOP
    v_suffix := v_suffix + 1;
    v_slug := v_base_slug || '-' || v_suffix;
  END LOOP;

  INSERT INTO public.schools (name, slug, address, phone, email, motto, principal_name, status, subscription_tier)
  VALUES (trim(p_name), v_slug, p_address, p_phone, p_email, p_motto, p_principal_name, 'pending', v_tier)
  RETURNING schools.id INTO v_id;

  RETURN QUERY SELECT v_id, v_slug;
END;
$$;

GRANT EXECUTE ON FUNCTION register_school_public TO anon, authenticated;

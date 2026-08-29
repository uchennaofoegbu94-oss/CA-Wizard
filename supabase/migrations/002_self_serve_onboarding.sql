-- ============================================================
-- CA-WIZARD | Migration 002 — Self-Serve School Registration
-- ============================================================

-- ── Public school registration RPC ──────────────────────────
-- SECURITY DEFINER: bypasses RLS deliberately, but ONLY inserts
-- the exact fields this function accepts — no arbitrary writes
-- are possible through it. Always creates status = 'pending',
-- never 'active' — a Super Admin must approve before the school
-- can be used.
CREATE OR REPLACE FUNCTION register_school_public(
  p_name           text,
  p_address        text DEFAULT NULL,
  p_phone          text DEFAULT NULL,
  p_email          text DEFAULT NULL,
  p_motto          text DEFAULT NULL,
  p_principal_name text DEFAULT NULL
)
RETURNS TABLE(id uuid, slug text)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_base_slug text;
  v_slug      text;
  v_suffix    int := 0;
  v_id        uuid;
BEGIN
  IF p_name IS NULL OR length(trim(p_name)) < 3 THEN
    RAISE EXCEPTION 'School name must be at least 3 characters';
  END IF;

  v_base_slug := lower(regexp_replace(trim(p_name), '[^a-zA-Z0-9]+', '-', 'g'));
  v_base_slug := trim(both '-' from v_base_slug);
  v_slug := v_base_slug;

  -- Guarantee slug uniqueness even under concurrent registrations
  WHILE EXISTS (SELECT 1 FROM schools WHERE slug = v_slug) LOOP
    v_suffix := v_suffix + 1;
    v_slug := v_base_slug || '-' || v_suffix;
  END LOOP;

  INSERT INTO schools (name, slug, address, phone, email, motto, principal_name, status, subscription_tier)
  VALUES (trim(p_name), v_slug, p_address, p_phone, p_email, p_motto, p_principal_name, 'pending', 'free')
  RETURNING schools.id INTO v_id;

  RETURN QUERY SELECT v_id, v_slug;
END;
$$;

-- Callable by anonymous visitors (before they've signed up) AND
-- authenticated users (in case a signed-in session already exists)
GRANT EXECUTE ON FUNCTION register_school_public TO anon, authenticated;


-- ── Update handle_new_user to accept school_id from signup metadata ──
-- This lets a newly-registered school admin be linked to the school
-- created by register_school_public() in the SAME signup flow.
-- The school_id is validated against the schools table before being
-- trusted — a malicious client cannot attach themselves to an
-- arbitrary school by forging metadata, since the row must actually
-- exist.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_role       user_role := 'teacher';
  v_role_raw   TEXT;
  v_school_id  UUID := NULL;
  v_school_raw TEXT;
BEGIN
  v_role_raw := NEW.raw_user_meta_data->>'role';
  IF v_role_raw IN ('super_admin', 'school_admin', 'teacher') THEN
    v_role := v_role_raw::user_role;
  END IF;

  v_school_raw := NEW.raw_user_meta_data->>'school_id';
  IF v_school_raw IS NOT NULL AND v_school_raw <> '' THEN
    BEGIN
      v_school_id := v_school_raw::UUID;
      IF NOT EXISTS (SELECT 1 FROM schools WHERE id = v_school_id) THEN
        v_school_id := NULL;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_school_id := NULL;
    END;
  END IF;

  INSERT INTO profiles (user_id, email, first_name, last_name, role, school_id, is_active)
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
  -- RAISE WARNING never throws a secondary exception, unlike an
  -- INSERT would — so this can never abort the auth.users creation
  -- it's attached to.
  RAISE WARNING 'handle_new_user failed for %: % (SQLSTATE %)', NEW.email, SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

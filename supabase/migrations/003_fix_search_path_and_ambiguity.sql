-- ============================================================
-- CA-WIZARD | Migration 003 — Fix search_path & column ambiguity
-- ============================================================
-- Root cause of both bugs: SECURITY DEFINER functions did not
-- fully qualify table/type references with "public.", and did
-- not pin their own search_path. When Supabase's internal auth
-- service fires handle_new_user on auth.users insert, it runs
-- in a session context where "public" is NOT guaranteed to be
-- in search_path — causing bare type/table names to fail to
-- resolve ("type user_role does not exist").
--
-- Separately, register_school_public's RETURNS TABLE(id, slug)
-- implicitly declares variables named "id" and "slug" inside the
-- function body, which collided with the schools.slug column
-- name in an unqualified WHERE clause ("column reference slug
-- is ambiguous").
--
-- Fix: qualify every reference with public., alias the table,
-- and explicitly pin search_path on every SECURITY DEFINER
-- function in the schema.
-- ============================================================

-- ── register_school_public: fix ambiguous "slug" + pin search_path ──
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
SET search_path = public, pg_temp
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

  -- Table aliased + fully qualified: "s.slug" can never collide
  -- with the function's own OUT parameter named "slug"
  WHILE EXISTS (SELECT 1 FROM public.schools s WHERE s.slug = v_slug) LOOP
    v_suffix := v_suffix + 1;
    v_slug := v_base_slug || '-' || v_suffix;
  END LOOP;

  INSERT INTO public.schools (name, slug, address, phone, email, motto, principal_name, status, subscription_tier)
  VALUES (trim(p_name), v_slug, p_address, p_phone, p_email, p_motto, p_principal_name, 'pending', 'free')
  RETURNING schools.id INTO v_id;

  RETURN QUERY SELECT v_id, v_slug;
END;
$$;

GRANT EXECUTE ON FUNCTION register_school_public TO anon, authenticated;


-- ── handle_new_user: fully qualify public.user_role / public.profiles / public.schools + pin search_path ──
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_role       public.user_role := 'teacher';
  v_role_raw   TEXT;
  v_school_id  UUID := NULL;
  v_school_raw TEXT;
BEGIN
  v_role_raw := NEW.raw_user_meta_data->>'role';
  IF v_role_raw IN ('super_admin', 'school_admin', 'teacher') THEN
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


-- ── get_my_profile: same hardening ──
CREATE OR REPLACE FUNCTION get_my_profile()
RETURNS TABLE(
  id uuid, user_id uuid, school_id uuid, role public.user_role,
  first_name text, last_name text, email text, phone text,
  avatar_url text, is_active boolean, created_at timestamptz, updated_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT p.id, p.user_id, p.school_id, p.role, p.first_name, p.last_name,
         p.email, p.phone, p.avatar_url, p.is_active, p.created_at, p.updated_at
  FROM public.profiles p
  WHERE p.user_id = auth.uid()
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION get_my_profile TO authenticated;


-- ── Harden the remaining RLS helper functions from migration 001 ──
-- Same class of bug could bite these too under an unusual calling
-- context, even though they've worked so far under normal client
-- sessions. Pinning search_path here is cheap insurance.

CREATE OR REPLACE FUNCTION current_user_profile()
RETURNS public.profiles AS $$
  SELECT * FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION current_user_role()
RETURNS public.user_role AS $$
  SELECT role FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION current_school_id()
RETURNS UUID AS $$
  SELECT school_id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND role = 'super_admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION is_school_admin(p_school_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid()
      AND school_id = p_school_id
      AND role = 'school_admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION teacher_has_class_access(p_class_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.teacher_assignments ta
    JOIN public.profiles p ON p.id = ta.teacher_id
    WHERE p.user_id = auth.uid()
      AND ta.class_id = p_class_id
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public, pg_temp;

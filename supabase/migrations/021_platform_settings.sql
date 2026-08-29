-- ============================================================
-- 021: platform settings (super admin)
-- ============================================================
-- The super-admin settings page was literally reusing the school-admin
-- SettingsPage component — same route, same file, nothing platform-
-- specific at all. This is the schema for an actually distinct page:
-- registration policy for new self-serve schools, and a real
-- maintenance-mode switch. Scoped deliberately narrow rather than
-- building every conceivable admin-console setting — see the app's
-- own delivery notes for what's out of scope here and why.

CREATE TABLE platform_settings (
  -- Singleton row pattern: id is always TRUE, the CHECK makes a second
  -- row physically impossible rather than just "shouldn't happen."
  id                          BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  default_subscription_tier  TEXT NOT NULL DEFAULT 'free',
  auto_approve_schools       BOOLEAN NOT NULL DEFAULT FALSE,
  maintenance_mode           BOOLEAN NOT NULL DEFAULT FALSE,
  maintenance_message        TEXT,
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by                 UUID REFERENCES profiles(id)
);

INSERT INTO platform_settings (id) VALUES (TRUE);

ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

-- Only super_admin ever reads or writes the full settings row.
CREATE POLICY "super_admin_platform_settings" ON platform_settings
  FOR ALL USING (is_super_admin());

-- Maintenance status specifically needs to be checkable by literally
-- everyone — including anonymous visitors and non-super-admin users
-- who are about to be blocked by it — which the policy above
-- deliberately does not allow. Rather than opening the whole table to
-- public reads (exposing default_subscription_tier/auto_approve_schools,
-- which are none of a random visitor's business), this narrow
-- SECURITY DEFINER function returns only the two maintenance fields.
CREATE OR REPLACE FUNCTION get_maintenance_status()
RETURNS TABLE(maintenance_mode BOOLEAN, maintenance_message TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT maintenance_mode, maintenance_message FROM platform_settings WHERE id = TRUE;
$$;

GRANT EXECUTE ON FUNCTION get_maintenance_status TO anon, authenticated;

-- register_school_public now reads default_subscription_tier and
-- auto_approve_schools from here instead of hardcoding 'free' and
-- always requiring manual approval. Only the BODY changes — the
-- parameter list (and therefore the function's identity, as far as
-- PostgREST's overload resolution is concerned) is untouched, so this
-- is a plain CREATE OR REPLACE, not the DROP-then-CREATE migration 011
-- needed when a parameter was actually added.
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

  SELECT default_subscription_tier, auto_approve_schools
  INTO v_settings
  FROM platform_settings WHERE id = TRUE;

  -- p_subscription_tier is still respected when the caller explicitly
  -- passes one (the landing page's pricing-plan CTAs do exactly this) —
  -- the platform default from settings only fills in when nothing was
  -- specified, same self-serve-only whitelist as migration 011.
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

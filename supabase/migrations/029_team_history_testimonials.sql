-- ============================================================
-- CA-WIZARD | Migration 029 — Meet the Team / History / Testimonials
-- ============================================================
-- Tier 3, Item #9. Confirmed design: flexible sections, work fine
-- with 0-few entries, no forced content.
--
-- "Flexible... no forced content" is handled by NOT modeling this
-- as a single fixed-shape "about page" row — each section is its
-- own table of independent rows. Zero rows in any of the three
-- means that section just doesn't render on the public page; there
-- is no minimum-count constraint, no placeholder row, nothing that
-- needs seeding before this is usable. Same single-author
-- restriction as the blog (025) — super_admin only for now.
-- ============================================================

CREATE TABLE team_members (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name           TEXT NOT NULL,
  role_title     TEXT NOT NULL,
  bio            TEXT,
  photo_url      TEXT,
  linkedin_url   TEXT,
  twitter_url    TEXT,
  display_order  INTEGER NOT NULL DEFAULT 0,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE history_events (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Free text, not a real DATE — company history is usually told in
  -- years or rough quarters ("2023", "Early 2024"), not exact dates,
  -- and forcing a real date column would demand false precision.
  date_label     TEXT NOT NULL,
  title          TEXT NOT NULL,
  description    TEXT,
  display_order  INTEGER NOT NULL DEFAULT 0,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE testimonials (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quote          TEXT NOT NULL,
  author_name    TEXT NOT NULL,
  -- Free text on purpose ("Principal, Jesuit High School") rather
  -- than a school_id FK — a testimonial should still exist and
  -- display correctly even if the referenced school is later
  -- renamed, suspended, or deleted from the platform.
  author_role    TEXT,
  photo_url      TEXT,
  rating         SMALLINT,
  display_order  INTEGER NOT NULL DEFAULT 0,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT testimonials_rating_range CHECK (rating IS NULL OR rating BETWEEN 1 AND 5)
);

CREATE INDEX idx_team_members_order ON team_members(display_order);
CREATE INDEX idx_history_events_order ON history_events(display_order);
CREATE INDEX idx_testimonials_order ON testimonials(display_order);

CREATE TRIGGER trg_team_members_updated_at
  BEFORE UPDATE ON team_members
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_history_events_updated_at
  BEFORE UPDATE ON history_events
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_testimonials_updated_at
  BEFORE UPDATE ON testimonials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ── RLS — identical shape across all three, same as blog_posts ──
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE history_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE testimonials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_read_active_team_members" ON team_members
  FOR SELECT USING (is_active);
CREATE POLICY "super_admin_all_team_members" ON team_members
  FOR ALL USING (is_super_admin());

CREATE POLICY "public_read_active_history_events" ON history_events
  FOR SELECT USING (is_active);
CREATE POLICY "super_admin_all_history_events" ON history_events
  FOR ALL USING (is_super_admin());

CREATE POLICY "public_read_active_testimonials" ON testimonials
  FOR SELECT USING (is_active);
CREATE POLICY "super_admin_all_testimonials" ON testimonials
  FOR ALL USING (is_super_admin());

GRANT SELECT ON team_members, history_events, testimonials TO anon;
GRANT ALL ON team_members, history_events, testimonials TO authenticated;


-- ── Storage: team/testimonial photos ─────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('site-content', 'site-content', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "public_read_site_content" ON storage.objects;
CREATE POLICY "public_read_site_content" ON storage.objects
  FOR SELECT USING (bucket_id = 'site-content');

DROP POLICY IF EXISTS "super_admin_write_site_content" ON storage.objects;
CREATE POLICY "super_admin_write_site_content" ON storage.objects
  FOR ALL USING (
    bucket_id = 'site-content'
    AND is_super_admin()
  );

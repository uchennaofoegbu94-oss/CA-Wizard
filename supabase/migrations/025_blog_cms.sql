-- ============================================================
-- CA-WIZARD | Migration 025 — Blog / CMS
-- ============================================================
-- Tier 3, Item #5. Confirmed design: single-author (super_admin
-- only) for now, shaped to extend to multi-author later.
--
-- "Shaped to extend" is handled structurally, not left as a TODO:
-- author_id is a real FK to profiles (not hardcoded/omitted), and
-- every query already carries it through and displays it. The ONLY
-- thing that currently limits this to super_admin is the RLS write
-- policy below. Widening to other roles later is a policy change,
-- not a schema migration or a frontend rewrite.
-- ============================================================

CREATE TYPE blog_post_status AS ENUM ('draft', 'published');

CREATE TABLE blog_posts (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  author_id         UUID NOT NULL REFERENCES profiles(id),
  title             TEXT NOT NULL,
  slug              TEXT NOT NULL UNIQUE,
  excerpt           TEXT,
  content           TEXT NOT NULL,
  cover_image_url   TEXT,
  status            blog_post_status NOT NULL DEFAULT 'draft',
  published_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_blog_posts_status_published ON blog_posts(status, published_at DESC);
CREATE INDEX idx_blog_posts_author ON blog_posts(author_id);

CREATE TRIGGER trg_blog_posts_updated_at
  BEFORE UPDATE ON blog_posts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ── RLS ───────────────────────────────────────────────────────
ALTER TABLE blog_posts ENABLE ROW LEVEL SECURITY;

-- Public (including anon — this backs the public /blog marketing
-- page) can only ever see published posts. Deliberately does NOT
-- check is_active-style flags beyond status, since there's no
-- separate archive state for posts yet — draft IS the "not public"
-- state.
CREATE POLICY "public_read_published_posts" ON blog_posts
  FOR SELECT USING (status = 'published');

-- Full access (drafts included) restricted to super_admin — this is
-- the single-author enforcement point. To open this up to other
-- authors later: add a policy alongside this one (e.g. "author can
-- manage their own drafts"), the schema needs nothing further.
CREATE POLICY "super_admin_all_posts" ON blog_posts
  FOR ALL USING (is_super_admin());

GRANT SELECT ON blog_posts TO anon;
GRANT ALL ON blog_posts TO authenticated;


-- ── Storage: cover images ────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('blog-media', 'blog-media', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "public_read_blog_media" ON storage.objects;
CREATE POLICY "public_read_blog_media" ON storage.objects
  FOR SELECT USING (bucket_id = 'blog-media');

-- Same single-author restriction as the table itself — only
-- super_admin can upload/replace cover images for now.
DROP POLICY IF EXISTS "super_admin_write_blog_media" ON storage.objects;
CREATE POLICY "super_admin_write_blog_media" ON storage.objects
  FOR ALL USING (
    bucket_id = 'blog-media'
    AND is_super_admin()
  );

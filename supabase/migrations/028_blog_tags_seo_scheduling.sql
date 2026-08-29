-- ============================================================
-- CA-WIZARD | Migration 028 — Blog: tags, SEO metadata,
--                              scheduled publishing
-- ============================================================
-- Follow-up to 025. Adds three of the five gaps flagged when the
-- blog shipped:
--   - tags (simple array, no separate taxonomy table — nothing in
--     the confirmed scope called for filtering/browsing by tag,
--     just labeling)
--   - meta_description (SEO, separate from excerpt so a shorter/
--     more search-oriented blurb can differ from the on-page one)
--   - scheduled publishing, implemented without a cron: status can
--     be 'published' with a future published_at, and the public
--     read policy now also requires published_at <= NOW(). No
--     external scheduler needed — a scheduled post simply isn't
--     visible yet, then becomes visible the moment someone loads
--     the page after its time passes.
--
-- Comments were deliberately NOT added — the confirmed scope was
-- "single-author... shaped to extend to multi-author later," which
-- is about who WRITES, not reader interaction. Public comments on
-- an anonymous-write-access blog need moderation/spam handling that
-- was never part of what was asked for.
-- ============================================================

ALTER TABLE blog_posts ADD COLUMN tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE blog_posts ADD COLUMN meta_description TEXT;

CREATE INDEX idx_blog_posts_tags ON blog_posts USING GIN (tags);


-- ── Scheduled publishing ─────────────────────────────────────
-- Was: status = 'published'. Now also requires published_at to
-- have actually arrived — a post can sit in status='published' with
-- a future published_at (set by the "Schedule for..." option) and
-- stay invisible to the public until then, with no cron/worker
-- required.
DROP POLICY IF EXISTS "public_read_published_posts" ON blog_posts;
CREATE POLICY "public_read_published_posts" ON blog_posts
  FOR SELECT USING (status = 'published' AND published_at <= NOW());

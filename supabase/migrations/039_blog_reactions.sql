-- ============================================================
-- CA-WIZARD | Migration 039 — Blog post reactions
-- ============================================================
-- Requested as the alternative to comments: engagement for
-- anonymous public visitors without the moderation/spam surface a
-- free-text comment system would need. A fixed, small set of emoji
-- reactions has no free-text field at all — there's nothing to
-- moderate, nothing to spam with content, nothing an attacker can
-- inject beyond "which of three predefined values."
--
-- No login required, matching the rest of the public blog — a
-- visitor is identified by an opaque, randomly-generated token
-- stored in their own browser (like a cookie, but simpler), not a
-- real account. This is a soft, honor-system dedup: it stops a
-- single click from being double-counted, not a determined person
-- from clearing storage and reacting again. That's an intentional,
-- proportionate tradeoff — this is a "like button," not a voting
-- system with integrity requirements; the worst case of it being
-- gamed is a slightly inflated count on a school-SaaS blog post, not
-- a security or data problem.
-- ============================================================

CREATE TABLE blog_post_reactions (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id        UUID NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
  visitor_token  UUID NOT NULL,
  reaction       TEXT NOT NULL CHECK (reaction IN ('like', 'love', 'insightful')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One of each reaction type per visitor per post — not one
  -- reaction total, so someone can both 👍 and 💡 the same post.
  UNIQUE (post_id, visitor_token, reaction)
);

CREATE INDEX idx_blog_post_reactions_post ON blog_post_reactions(post_id);

ALTER TABLE blog_post_reactions ENABLE ROW LEVEL SECURITY;

-- Fully public read — needed to compute and display counts, and a
-- visitor_token carries no identifying information on its own, so
-- there's no privacy concern in anyone being able to see the raw rows.
CREATE POLICY "public_read_reactions" ON blog_post_reactions
  FOR SELECT USING (TRUE);

-- Can only react to an actually-published post — stops reacting to
-- drafts (which shouldn't be discoverable anyway, but this closes
-- the door at the data layer too, not just the UI).
CREATE POLICY "public_add_reaction" ON blog_post_reactions
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM blog_posts bp WHERE bp.id = post_id AND bp.status = 'published')
  );

-- Un-reacting (toggling off) — no ownership check is possible for a
-- genuinely anonymous visitor beyond knowing their own token, which
-- is exactly the same soft-trust model as the insert above.
CREATE POLICY "public_remove_reaction" ON blog_post_reactions
  FOR DELETE USING (TRUE);

GRANT SELECT, INSERT, DELETE ON blog_post_reactions TO anon, authenticated;

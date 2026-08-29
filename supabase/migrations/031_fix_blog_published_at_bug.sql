-- ============================================================
-- CA-WIZARD | Migration 031 — Fix blog visibility bug:
--                              published with no published_at
-- ============================================================
-- Root cause: migration 028 changed the public read policy on
-- blog_posts to `status = 'published' AND published_at <= NOW()`
-- to support scheduled publishing. If a row ever ends up with
-- status = 'published' but published_at IS NULL — which the app's
-- own Publish/Schedule buttons never do, but editing the row
-- directly (e.g. via Supabase's table editor while testing) can —
-- the comparison `NULL <= NOW()` evaluates to NULL, and Postgres
-- RLS treats NULL as "not visible," not "visible." The post
-- disappears completely for anon/public visitors with no error;
-- it still shows fine to super_admin (covered by a separate,
-- unaffected policy), which is exactly the confusing symptom this
-- produces — "it's right there in the admin list, but the public
-- link goes nowhere."
--
-- Fixed at the data layer, not by loosening the RLS check: a
-- trigger now guarantees published_at can never be null while
-- status = 'published', regardless of what sets that status — the
-- app's buttons, a future admin tool, or a manual edit in Supabase
-- Studio. The RLS policy itself is untouched and stays strict,
-- because the invariant it depends on is now actually enforced.
-- ============================================================

CREATE OR REPLACE FUNCTION enforce_blog_post_published_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'published' AND NEW.published_at IS NULL THEN
    NEW.published_at := NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

CREATE TRIGGER trg_enforce_blog_post_published_at
  BEFORE INSERT OR UPDATE ON blog_posts
  FOR EACH ROW EXECUTE FUNCTION enforce_blog_post_published_at();

-- Backfill: fixes any post already stuck invisible in exactly this
-- state right now, using this same moment as its effective publish
-- time (the closest available approximation of "when it actually
-- went live," since the real intended time was never recorded).
UPDATE blog_posts
SET published_at = NOW()
WHERE status = 'published' AND published_at IS NULL;

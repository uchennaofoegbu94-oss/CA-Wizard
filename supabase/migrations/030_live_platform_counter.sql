-- ============================================================
-- CA-WIZARD | Migration 030 — Live tenant/teacher counter
-- ============================================================
-- Tier 3, Item #10. Confirmed design: build the counting infra now,
-- gate display behind a manually-flipped toggle (default off),
-- rounded/banded format when shown.
--
-- "Build the infra now" means the counting function ships and works
-- today even though nobody sees it until the toggle flips — same
-- shape as maintenance_mode in 021 (a platform_settings flag +
-- SECURITY DEFINER function + anon EXECUTE grant), reused
-- deliberately rather than inventing a second pattern.
--
-- Banding happens IN THE FUNCTION, not in the frontend. The public
-- landing page has zero authentication, so whatever this function
-- returns is visible to anyone who opens devtools — if band_count()
-- lived in TypeScript instead, the real exact count would sit
-- unbanded in the network tab even while the page displays a rounded
-- figure. Banding at the source means the exact number is never
-- transmitted at all, not just hidden by presentation.
-- ============================================================

ALTER TABLE platform_settings ADD COLUMN show_live_counter BOOLEAN NOT NULL DEFAULT FALSE;

-- Floors a count down to a "nice" round number for public display.
-- Never rounds UP — the platform should never look bigger than it
-- actually is. Below 5, returns the exact count: banding a number
-- that small either rounds it to 0 (looks broken) or inflates a
-- genuinely tiny number (misleading in the other direction).
CREATE OR REPLACE FUNCTION band_count(p_count INTEGER)
RETURNS INTEGER AS $$
BEGIN
  IF p_count IS NULL OR p_count < 1 THEN
    RETURN 0;
  ELSIF p_count >= 1000 THEN
    RETURN (p_count / 100) * 100;
  ELSIF p_count >= 100 THEN
    RETURN (p_count / 50) * 50;
  ELSIF p_count >= 20 THEN
    RETURN (p_count / 10) * 10;
  ELSIF p_count >= 5 THEN
    RETURN (p_count / 5) * 5;
  ELSE
    RETURN p_count;
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp;

-- Returns the toggle state alongside the (already-banded) counts so
-- the frontend can do it in one round trip: check `enabled`, only
-- render if true. Exact counts (active schools, active teachers —
-- same "active" definitions used elsewhere: schools.status='active',
-- profiles.role='teacher' AND is_active) are computed here and never
-- leave this function unbanded.
CREATE OR REPLACE FUNCTION get_platform_stats()
RETURNS TABLE(enabled BOOLEAN, schools_count INTEGER, teachers_count INTEGER)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    (SELECT show_live_counter FROM platform_settings WHERE id = TRUE),
    band_count((SELECT COUNT(*)::INTEGER FROM schools WHERE status = 'active')),
    band_count((SELECT COUNT(*)::INTEGER FROM profiles WHERE role = 'teacher' AND is_active = TRUE));
$$;

GRANT EXECUTE ON FUNCTION get_platform_stats TO anon, authenticated;

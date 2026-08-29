-- ============================================================
-- 015: auto-generated admission numbers
-- ============================================================
-- Format: {ABBREVIATION}/{YEAR-ENROLLED}/{3-DIGIT-ROLL-NUMBER}
-- e.g. JHS/2026/004 for a student enrolling in 2026 at a school
-- whose abbreviation is JHS.

-- ── School abbreviation ─────────────────────────────────────
-- Auto-inferred from the school name, but stored as a plain editable
-- column (not recomputed on every name change) so a school_admin can
-- correct it in Settings if the inference gets it wrong.
ALTER TABLE schools ADD COLUMN IF NOT EXISTS abbreviation TEXT;

-- Takes initials of every word up to and INCLUDING the first word that
-- matches a known institution-type keyword ("school", "college",
-- "university", etc.) — anything after that keyword is deliberately
-- ignored. E.g. "Jesuit High School" -> J + H + S -> "JHS". A school
-- name with no such keyword just takes initials of every word.
CREATE OR REPLACE FUNCTION compute_school_abbreviation(p_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_words TEXT[];
  v_keywords TEXT[] := ARRAY['school', 'college', 'university', 'academy', 'institute', 'polytechnic', 'seminary'];
  v_stop_index INT := NULL;
  v_result TEXT := '';
  i INT;
BEGIN
  v_words := regexp_split_to_array(trim(p_name), '\s+');

  FOR i IN 1 .. array_length(v_words, 1) LOOP
    IF lower(v_words[i]) = ANY(v_keywords) THEN
      v_stop_index := i;
      EXIT;
    END IF;
  END LOOP;

  IF v_stop_index IS NULL THEN
    v_stop_index := array_length(v_words, 1);
  END IF;

  FOR i IN 1 .. v_stop_index LOOP
    IF length(v_words[i]) > 0 THEN
      v_result := v_result || upper(left(v_words[i], 1));
    END IF;
  END LOOP;

  RETURN v_result;
END;
$$;

-- Backfill existing schools that don't have one yet
UPDATE schools SET abbreviation = compute_school_abbreviation(name) WHERE abbreviation IS NULL;

-- Auto-infer on creation of new schools too (register_school_public and
-- any direct insert), but only when the caller didn't already supply one
CREATE OR REPLACE FUNCTION set_default_school_abbreviation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.abbreviation IS NULL THEN
    NEW.abbreviation := compute_school_abbreviation(NEW.name);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_default_school_abbreviation ON schools;
CREATE TRIGGER trg_set_default_school_abbreviation
  BEFORE INSERT ON schools
  FOR EACH ROW EXECUTE FUNCTION set_default_school_abbreviation();

-- ── Atomic per-school-per-year roll number counter ──────────
-- A plain COUNT(*)+1 approach has a race condition under concurrent
-- student creation; an UPSERT...ON CONFLICT DO UPDATE is a single
-- atomic statement in Postgres (row-level lock held for its duration),
-- so two admins adding a student at the same instant can't collide.
CREATE TABLE IF NOT EXISTS admission_number_counters (
  school_id    UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  year         INT NOT NULL,
  last_number  INT NOT NULL DEFAULT 0,
  PRIMARY KEY (school_id, year)
);

ALTER TABLE admission_number_counters ENABLE ROW LEVEL SECURITY;
-- No direct policies at all — this table is only ever touched via the
-- SECURITY DEFINER function below, never queried or written directly
-- by any role, including school_admin.

CREATE OR REPLACE FUNCTION generate_admission_number(p_school_id UUID, p_year INT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_abbreviation TEXT;
  v_next INT;
BEGIN
  -- SECURITY DEFINER bypasses RLS entirely, so this check is what
  -- actually stops an authenticated user from one school generating
  -- (and incrementing!) admission numbers for a school they don't
  -- belong to — GRANT EXECUTE alone isn't a school boundary.
  IF NOT (current_school_id() = p_school_id OR is_super_admin()) THEN
    RAISE EXCEPTION 'Not authorized to generate admission numbers for this school';
  END IF;

  SELECT abbreviation INTO v_abbreviation FROM schools WHERE id = p_school_id;
  IF v_abbreviation IS NULL OR v_abbreviation = '' THEN
    v_abbreviation := 'SCH';
  END IF;

  INSERT INTO admission_number_counters (school_id, year, last_number)
  VALUES (p_school_id, p_year, 1)
  ON CONFLICT (school_id, year) DO UPDATE SET last_number = admission_number_counters.last_number + 1
  RETURNING last_number INTO v_next;

  RETURN v_abbreviation || '/' || p_year || '/' || lpad(v_next::text, 3, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION generate_admission_number TO authenticated;

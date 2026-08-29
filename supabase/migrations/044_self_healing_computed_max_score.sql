-- ============================================================
-- CA-WIZARD | Migration 044 — Self-Healing max_score for Computed Fields
-- ============================================================
-- assessment_categories.max_score for a COMPUTED field was never
-- actually derived from its sources/weights/operation — the
-- Add/Edit Field form only shows a Max Score input for field_type =
-- 'input' (the field is hidden for computed fields), so a newly
-- created computed field silently saves whatever the form's default
-- happened to be (10), completely disconnected from its real
-- resolved denominator (e.g. an 'average' field's true max is the
-- weighted average of its sources' own max_scores; a
-- 'weighted_percentage' field's true max is the sum of its weights).
-- Anywhere that value gets displayed — most visibly the source-field
-- picker's "/{max_score}" label when a computed field is itself
-- selectable as a source for another computed field — showed a
-- number with no relationship to reality.
--
-- Fix: max_score for a computed field is no longer admin-entered at
-- all. It's recomputed automatically, server-side, using the exact
-- same formula the compute engine (resolve_score_fields) uses,
-- every time something that could change it happens:
--   - score_field_sources changes (a source added/removed/reweighted)
--   - an INPUT field's own max_score changes (shifts every computed
--     field that (transitively) depends on it)
--   - a computed field's compute_operation changes
-- Because a computed field's sources can themselves be computed
-- fields (migration 043), this has to be a fixed-point recompute
-- across ALL computed fields, not a single local calculation — the
-- same fixed-point pattern resolve_score_fields uses for actual
-- values, applied here to the static max_score column instead.
--
-- One consequence of this surfaced immediately on a real database:
-- for 'sum'/'average', weight is a straight multiplier (see the
-- AssessmentsPage.tsx fix in the same delivery — "this field will be
-- out of X points"), so a modest weight on a small source can easily
-- resolve to a max north of 999.99 — the ceiling of the ORIGINAL
-- max_score NUMERIC(5,2) column. Worse: since the recompute runs
-- inside the same trigger/transaction as whatever save touched
-- score_field_sources, an overflow there doesn't just fail silently
-- later — it rolls back the admin's save right then, with a cryptic
-- "numeric field overflow" error. Fixed two ways: the column is
-- widened to comfortably fit any realistic weight-multiplied value,
-- and the recompute defensively clamps anything still outside that
-- (a genuinely extreme misconfiguration) rather than ever raising —
-- a save should never hard-fail because of what this column merely
-- displays.
ALTER TABLE assessment_categories ALTER COLUMN max_score TYPE NUMERIC(14, 2);
-- ============================================================

CREATE OR REPLACE FUNCTION recompute_computed_max_scores_now()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_resolved   JSONB := '{}'::jsonb;
  v_progress   BOOLEAN;
  v_field      RECORD;
  v_src        RECORD;
  v_all_ready  BOOLEAN;
  v_sum_max    NUMERIC;
  v_sum_weight NUMERIC;
  v_new_max    NUMERIC;
  -- Matches the column's widened precision (NUMERIC(14,2)) above —
  -- kept as an explicit constant here so a value is always clamped
  -- to something the column can actually hold, no matter how extreme
  -- the underlying weights get. A save should never hard-fail
  -- because of what this column merely displays.
  v_max_representable CONSTANT NUMERIC := 999999999999.99;
BEGIN
  -- Seed every input field's own stored max_score — that value IS
  -- authoritative for an input field (it's the only thing that
  -- defines it), unlike for a computed field.
  FOR v_field IN SELECT id, max_score FROM assessment_categories WHERE field_type = 'input' LOOP
    v_resolved := v_resolved || jsonb_build_object(v_field.id::text, v_field.max_score);
  END LOOP;

  -- Fixed-point: resolve a computed field's true max as soon as every
  -- one of its sources (input or computed) has a resolved max.
  LOOP
    v_progress := FALSE;
    FOR v_field IN
      SELECT ac.id, ac.compute_operation
      FROM assessment_categories ac
      WHERE ac.field_type = 'computed' AND NOT (v_resolved ? ac.id::text)
    LOOP
      v_all_ready := TRUE;
      v_sum_max := 0; v_sum_weight := 0;

      FOR v_src IN SELECT sfs.source_field_id, sfs.weight FROM score_field_sources sfs WHERE sfs.field_id = v_field.id LOOP
        IF NOT (v_resolved ? v_src.source_field_id::text) THEN
          v_all_ready := FALSE;
          EXIT;
        END IF;
        v_sum_max := v_sum_max + (v_resolved ->> v_src.source_field_id::text)::numeric * v_src.weight;
        v_sum_weight := v_sum_weight + v_src.weight;
      END LOOP;

      IF v_all_ready THEN
        v_new_max := CASE v_field.compute_operation
          WHEN 'sum' THEN v_sum_max
          WHEN 'average' THEN v_sum_max / NULLIF(v_sum_weight, 0)
          WHEN 'weighted_percentage' THEN v_sum_weight
        END;
        v_new_max := COALESCE(v_new_max, 0);
        -- Defensive clamp: an admin-chosen weight can in principle
        -- push this arbitrarily high (see the comment at the top of
        -- this migration) — cap rather than let a genuinely extreme
        -- value ever reach the UPDATE below and risk an overflow
        -- error aborting someone else's unrelated save.
        IF v_new_max > v_max_representable THEN
          RAISE WARNING 'recompute_computed_max_scores: field % resolved max % exceeds the storable limit — clamped to %. Check its weights.',
            v_field.id, v_new_max, v_max_representable;
          v_new_max := v_max_representable;
        END IF;
        -- A computed field with zero sources selected (nothing to
        -- compute from yet) resolves to 0 rather than being left
        -- blank — matches how the live compute engine treats an
        -- unresolvable field, and keeps the column non-null.
        v_resolved := v_resolved || jsonb_build_object(v_field.id::text, ROUND(v_new_max, 2));
        v_progress := TRUE;
      END IF;
    END LOOP;
    EXIT WHEN NOT v_progress;
  END LOOP;

  -- Persist only the fields whose stored value actually changed —
  -- avoids no-op writes (and their own trigger firings) on every pass.
  UPDATE assessment_categories ac
  SET max_score = (v_resolved ->> ac.id::text)::numeric
  WHERE ac.field_type = 'computed'
    AND (v_resolved ? ac.id::text)
    AND ac.max_score IS DISTINCT FROM (v_resolved ->> ac.id::text)::numeric;
END;
$$;

-- Thin trigger wrapper — trigger functions can't be called directly
-- outside trigger context (they need NEW/OLD/TG_* in scope), so the
-- real logic lives in the plain function above, callable both from a
-- trigger and directly (used by the one-time backfill at the bottom
-- of this migration).
CREATE OR REPLACE FUNCTION recompute_computed_max_scores()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM recompute_computed_max_scores_now();
  RETURN NULL; -- AFTER trigger — return value is ignored
END;
$$;

-- Fires whenever a source relationship is added, reweighted, or
-- removed — the direct trigger for "I just changed what a computed
-- field is built from."
DROP TRIGGER IF EXISTS trg_recompute_max_on_sources_change ON score_field_sources;
CREATE TRIGGER trg_recompute_max_on_sources_change
  AFTER INSERT OR UPDATE OF weight OR DELETE ON score_field_sources
  FOR EACH STATEMENT EXECUTE FUNCTION recompute_computed_max_scores();

-- Fires when an INPUT field's own max_score changes (shifts the true
-- max of every computed field that transitively depends on it), or
-- when a COMPUTED field's compute_operation changes (sum vs average
-- vs weighted_percentage resolve to different maxes from the same
-- sources). Deliberately NOT triggered by a plain UPDATE of
-- max_score on a computed field in general — only input-field
-- max_score changes should re-trigger, otherwise this function's own
-- corrective UPDATE above would re-fire itself.
DROP TRIGGER IF EXISTS trg_recompute_max_on_input_max_change ON assessment_categories;
CREATE TRIGGER trg_recompute_max_on_input_max_change
  AFTER UPDATE OF max_score ON assessment_categories
  FOR EACH ROW
  WHEN (NEW.field_type = 'input' AND OLD.max_score IS DISTINCT FROM NEW.max_score)
  EXECUTE FUNCTION recompute_computed_max_scores();

DROP TRIGGER IF EXISTS trg_recompute_max_on_operation_change ON assessment_categories;
CREATE TRIGGER trg_recompute_max_on_operation_change
  AFTER UPDATE OF compute_operation ON assessment_categories
  FOR EACH ROW
  WHEN (NEW.field_type = 'computed' AND OLD.compute_operation IS DISTINCT FROM NEW.compute_operation)
  EXECUTE FUNCTION recompute_computed_max_scores();

-- One-time backfill: correct every already-saved computed field's
-- max_score right now, for every school, so this migration fixes
-- existing bad data (e.g. fields stuck at the old form default of 10)
-- immediately, not just newly-saved fields going forward.
DO $$
BEGIN
  PERFORM recompute_computed_max_scores_now();
END;
$$;

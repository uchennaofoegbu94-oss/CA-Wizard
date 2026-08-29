-- ============================================================
-- CA-WIZARD | Migration 009 — Signatures & school stamp
-- ============================================================
-- Most schools have exactly one scanned principal signature and
-- one stamp, reused across every report card — so these live on
-- the school itself rather than per-teacher, keeping the upload
-- flow to one place in Settings.

ALTER TABLE schools ADD COLUMN IF NOT EXISTS principal_signature_url TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS teacher_signature_url   TEXT;
ALTER TABLE schools ADD COLUMN IF NOT EXISTS school_stamp_url        TEXT;

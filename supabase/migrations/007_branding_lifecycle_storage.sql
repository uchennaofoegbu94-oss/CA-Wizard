-- ============================================================
-- CA-WIZARD | Migration 007 — School branding, student lifecycle
--                              (promote/graduate/transfer), storage
-- ============================================================

-- ── School Branding ──────────────────────────────────────────
ALTER TABLE schools ADD COLUMN IF NOT EXISTS primary_color   TEXT NOT NULL DEFAULT '#1e3a8a';
ALTER TABLE schools ADD COLUMN IF NOT EXISTS secondary_color TEXT NOT NULL DEFAULT '#3b82f6';
ALTER TABLE schools ADD COLUMN IF NOT EXISTS watermark_url   TEXT;

-- ── Student Lifecycle: promote / graduate / transfer ────────
DO $$ BEGIN
  CREATE TYPE student_status AS ENUM ('active', 'graduated', 'transferred_out', 'withdrawn');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE students ADD COLUMN IF NOT EXISTS status student_status NOT NULL DEFAULT 'active';

-- Transfer-IN (student joined this school from elsewhere)
ALTER TABLE students ADD COLUMN IF NOT EXISTS is_transfer_student  BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE students ADD COLUMN IF NOT EXISTS previous_school_name TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS transfer_in_date     DATE;

-- Transfer-OUT (student left this school for elsewhere)
ALTER TABLE students ADD COLUMN IF NOT EXISTS transfer_out_date    DATE;
ALTER TABLE students ADD COLUMN IF NOT EXISTS transfer_out_reason  TEXT;

-- Keep is_active in sync with status automatically, so every
-- existing query filtering on is_active continues to work exactly
-- as before without needing to know about the new status column.
CREATE OR REPLACE FUNCTION sync_student_is_active()
RETURNS TRIGGER AS $$
BEGIN
  NEW.is_active := (NEW.status = 'active');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_student_is_active ON students;
CREATE TRIGGER trg_sync_student_is_active
  BEFORE INSERT OR UPDATE OF status ON students
  FOR EACH ROW EXECUTE FUNCTION sync_student_is_active();


-- ── Storage Buckets ──────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('school-branding', 'school-branding', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('people-photos', 'people-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Public read on both buckets (logos, watermarks, and photos are
-- meant to be visible on report cards/transcripts without auth)
DROP POLICY IF EXISTS "public_read_school_branding" ON storage.objects;
CREATE POLICY "public_read_school_branding" ON storage.objects
  FOR SELECT USING (bucket_id = 'school-branding');

DROP POLICY IF EXISTS "public_read_people_photos" ON storage.objects;
CREATE POLICY "public_read_people_photos" ON storage.objects
  FOR SELECT USING (bucket_id = 'people-photos');

-- Write access restricted to members of the matching school.
-- Upload path convention: {school_id}/logo.png, {school_id}/watermark.png,
-- {school_id}/students/{student_id}.jpg, {school_id}/teachers/{profile_id}.jpg
-- — the first path segment must equal the caller's own school_id.
DROP POLICY IF EXISTS "school_member_write_branding" ON storage.objects;
CREATE POLICY "school_member_write_branding" ON storage.objects
  FOR ALL USING (
    bucket_id = 'school-branding'
    AND (storage.foldername(name))[1] = current_school_id()::text
  );

DROP POLICY IF EXISTS "school_member_write_photos" ON storage.objects;
CREATE POLICY "school_member_write_photos" ON storage.objects
  FOR ALL USING (
    bucket_id = 'people-photos'
    AND (storage.foldername(name))[1] = current_school_id()::text
  );

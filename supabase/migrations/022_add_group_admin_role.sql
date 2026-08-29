-- ============================================================
-- CA-WIZARD | Migration 022 — Add 'group_admin' to user_role
-- ============================================================
-- Split into its own migration file (rather than combined with 023)
-- because Postgres will not let a newly-added enum value be
-- referenced (cast to, compared against, used in a DEFAULT, etc.)
-- inside the SAME transaction that added it. Since each migration
-- file runs as one transaction, 023 — which uses 'group_admin' in
-- column defaults, RLS policies, and handle_new_user's role
-- whitelist — must run strictly after this one commits.
--
-- group_admin is platform staff, same pattern as super_admin: no
-- school_id, not part of any single school. They oversee a set of
-- schools via the admin_groups table (see 023), not by being a
-- school_admin anywhere.
-- ============================================================

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'group_admin';

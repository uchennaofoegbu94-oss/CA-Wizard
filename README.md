# CA-Wizard

Multi-tenant School Assessment Management PWA. Built for schools to run continuous assessment (CA), terminal exams, and report card generation — with offline-capable score entry for teachers in low-connectivity environments.

## Tech Stack
Vite · React 18 · TypeScript · TailwindCSS · shadcn/ui · Supabase (Postgres + Auth + RLS) · React Query · React Hook Form · Zod · IndexedDB (`idb`) · Vercel

## Phase 1 — What's Included (this delivery)
- ✅ Full project scaffold (Vite + React + TS + Tailwind + shadcn/ui wired up)
- ✅ Complete normalized Supabase schema — 23 tables, 2 computed views, full RLS on every table
- ✅ Seed data — demo school ("Mirror International School"), session, terms, class levels/arms, subjects, assessment categories, grading system
- ✅ Auth flow — email/password login, teacher invite-code join, role-based redirect, Supabase session persistence
- ✅ Super Admin UI — dashboard + full Schools CRUD (create, edit, suspend/activate, delete)
- ✅ School Admin & Teacher dashboards (shells ready, feature pages stubbed for Phase 2)
- ✅ Offline infrastructure — IndexedDB store + network status context, ready for Phase 2/3 score entry
- ✅ PWA manifest + service worker config (installable, offline app shell caching)
- ✅ Full documentation: ERD, UI wireframe plan, deployment plan (this folder, see `docs/`)

## Quick Start
```bash
npm install
cp .env.example .env   # fill in your Supabase URL + anon key
npm run dev
```
See `docs/DEPLOYMENT_PLAN.md` for full Supabase + Vercel setup instructions, including how to create your Super Admin account and run the SQL migration.

## Project Structure
```
src/
  components/
    ui/          shadcn/ui primitives (button, input, dialog, table, etc.)
    layout/      AppShell (sidebar nav), RequireAuth (route guards)
  contexts/      AuthContext (session/profile/role), NetworkContext (online/offline + sync count)
  lib/           supabase.ts (client), idb.ts (offline store), utils.ts (helpers)
  pages/
    auth/        Login, Join-via-invite-code
    super-admin/ Dashboard, Schools CRUD
    school-admin/Dashboard (+ Phase 2 placeholders for Sessions/Classes/Students/etc.)
    teacher/     Dashboard (+ Phase 2 placeholders for Score Entry/Broadsheet)
  types/         Full TypeScript types matching the DB schema
  App.tsx        All routes, role guards, providers wired up
supabase/
  migrations/    001_initial_schema.sql — the entire DB in one migration
docs/
  ERD.md                 Mermaid ERD + key schema design decisions
  UI_WIREFRAME_PLAN.md   Screen inventory by role + Phase 2/3 detail
  DEPLOYMENT_PLAN.md     Supabase + GitHub + Vercel step-by-step
```

## Roles
- **Super Admin** — platform owner. Creates/suspends schools, views all tenants.
- **School Admin** — runs one school. Full CRUD on sessions, terms, classes, subjects, students, teacher invites, assessment config, grading, reports.
- **Teacher** — joins a school via invite code. Sees only their assigned classes/subjects. Enters scores, including offline.

## Multi-Tenancy & Security
Every tenant-scoped table carries `school_id`. Row Level Security is enabled on all 23 tables — a school's data is invisible to every other school at the database layer, not just hidden in the UI. See `docs/ERD.md` → "Key Design Decisions" for the full RLS strategy.

## What's Next (Phase 2+)
Sessions/Terms management, Classes & Students CRUD, Subjects per class level, Teacher invite generation UI, Assessment category & Grading system editors, the offline-capable Score Entry grid, CA Broadsheet view, and Report Card generation with PDF export — each phase will be committed and deployed separately per `docs/DEPLOYMENT_PLAN.md`.

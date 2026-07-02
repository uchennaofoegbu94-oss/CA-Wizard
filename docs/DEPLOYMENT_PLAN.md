# CA-Wizard — Deployment Plan

## Overview
Two systems to stand up: **Supabase** (database + auth) and **Vercel** (hosting). Both are free-tier friendly for development and demo use.

---

## Part A — Supabase Setup

### A1. Create the project
1. Go to https://supabase.com/dashboard → **New Project**
2. Name: `ca-wizard-production` (or `ca-wizard-staging` for a test environment)
3. Choose a strong database password and **save it somewhere safe** — you'll need it for CLI migrations
4. Pick a region close to Nigeria (e.g. `eu-west-1` London or `eu-central-1` Frankfurt) for lowest latency
5. Wait ~2 minutes for provisioning

### A2. Run the migration
**Option 1 — Dashboard SQL Editor (easiest for Phase 1):**
1. Open your project → **SQL Editor** → **New Query**
2. Paste the entire contents of `supabase/migrations/001_initial_schema.sql`
3. Click **Run**. You should see "Success. No rows returned" — this means all tables, RLS policies, and seed data were created.

**Option 2 — Supabase CLI (recommended once you have more migrations):**
```bash
npm install -g supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

### A3. Create the Super Admin user
1. Dashboard → **Authentication** → **Users** → **Add User**
2. Enter your email and a password, check "Auto Confirm User"
3. Copy the generated **User UID**
4. Go back to **SQL Editor** and run:
```sql
UPDATE profiles
SET role = 'super_admin', school_id = NULL
WHERE user_id = 'PASTE-USER-UID-HERE';
```
5. You can now log in to the app as Super Admin with that email/password.

### A4. Get your API keys
1. Dashboard → **Project Settings** → **API**
2. Copy **Project URL** → this is `VITE_SUPABASE_URL`
3. Copy **anon public key** → this is `VITE_SUPABASE_ANON_KEY`

---

## Part B — Local Development

```bash
# 1. Extract the project and install dependencies
cd ca-wizard
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env and paste in your Supabase URL + anon key from step A4

# 3. Run the dev server
npm run dev
# Visit http://localhost:5173
```

Log in with the Super Admin credentials created in A3. You should land on `/super-admin` and see the demo school ("Mirror International School") already seeded.

---

## Part C — GitHub

### C1. Initialize and push (first time)
```bash
cd ca-wizard
git init
git add .
git commit -m "Phase 1: project scaffold, full Supabase schema, auth, Super Admin UI"
git branch -M main

# Create a new EMPTY repo on github.com first (no README/license), then:
git remote add origin https://github.com/<your-username>/ca-wizard.git
git push -u origin main
```

> Note: `.env` is already in `.gitignore` — your Supabase keys will never be committed. Vercel gets them separately in Part D.

### C2. Committing after each future phase
```bash
git add .
git commit -m "Phase 2: school admin CRUD (sessions, classes, students, subjects, teachers)"
git push
```
Use one commit per completed phase so the history doubles as a build log. Suggested phase commit messages going forward:
- `Phase 2: school admin CRUD + teacher invite flow`
- `Phase 3: score entry grid + offline sync worker`
- `Phase 4: CA broadsheet + report card generation + PDF export`
- `Phase 5: polish, PWA install prompt, production hardening`

---

## Part D — Vercel Deployment

### D1. Import the project
1. Go to https://vercel.com/new
2. Click **Import Git Repository** → select your `ca-wizard` GitHub repo
3. Framework Preset: Vercel auto-detects **Vite** — leave defaults:
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Install Command: `npm install`

### D2. Add environment variables
Before clicking Deploy, expand **Environment Variables** and add:

| Key | Value |
|---|---|
| `VITE_SUPABASE_URL` | (from Supabase Part A4) |
| `VITE_SUPABASE_ANON_KEY` | (from Supabase Part A4) |
| `VITE_SUPER_ADMIN_EMAIL` | your super admin email |

Apply these to **Production**, **Preview**, and **Development** environments.

### D3. Deploy
Click **Deploy**. Vercel builds and gives you a live URL like `ca-wizard.vercel.app`.

### D4. Every future push auto-deploys
Once connected, every `git push` to `main` triggers a new Production deployment automatically. Pushes to other branches create Preview deployments with their own URL — useful for testing Phase 2/3 work before merging to `main`.

### D5. Custom domain (optional, later)
Vercel → Project → **Settings** → **Domains** → add your domain (e.g. `app.ca-wizard.com`) and follow the DNS instructions shown.

---

## Part E — Verifying the Deployment
1. Visit your Vercel URL → should redirect to `/auth/login`
2. Log in as Super Admin → should land on `/super-admin` and see "Mirror International School" in the Schools table
3. Try **Add School** → confirm a new school appears immediately (tests Supabase write + RLS)
4. Try **Suspend** on a school → confirm status badge updates (tests RLS update policy)
5. Open the app on your phone, use **Add to Home Screen** → confirms the PWA manifest is working

---

## Part F — Environment Promotion Strategy (for later phases)
As the app grows, consider running two Supabase projects:
- `ca-wizard-staging` — connected to a Vercel **Preview** branch, used to test Phase 2/3 features safely
- `ca-wizard-production` — connected to `main`, used by real schools

This avoids ever testing migrations or RLS changes against live student data.

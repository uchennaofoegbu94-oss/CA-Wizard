# CA-Wizard — API Layer

CA-Wizard has no custom backend server — Supabase **is** the API layer. The client talks directly to Postgres through the Supabase JS SDK (`src/lib/supabase.ts`), and Row Level Security enforces every authorization rule that would normally live in API route handlers.

## Why no REST/GraphQL server
1. RLS policies in `001_initial_schema.sql` already encode every access rule (super admin sees all, school members see only their school, teachers see only assigned classes, locked terms reject writes). Duplicating that logic in API middleware would be redundant and a drift risk.
2. React Query (`@tanstack/react-query`) handles caching, retries, and stale-while-revalidate directly against Supabase queries — functionally replacing the "data fetching layer" a REST API would provide.
3. Supabase Auth issues JWTs containing `auth.uid()`, which the helper SQL functions (`current_user_profile()`, `current_school_id()`, `is_super_admin()`, etc.) read directly inside RLS policies — no separate auth middleware needed.

## Data Access Pattern
Every page follows the same shape, established in `SchoolsPage.tsx`:

```ts
// 1. Typed query function — thin wrapper around supabase-js
async function fetchSchools(): Promise<School[]> {
  const { data, error } = await supabase.from('schools').select('*').order('name')
  if (error) throw error
  return data as School[]
}

// 2. React Query hook in the component
const { data, isLoading } = useQuery({ queryKey: ['schools'], queryFn: fetchSchools })

// 3. Mutations follow the same pattern with useMutation + queryClient.invalidateQueries
```

This pattern is reused for every Phase 2+ feature (Sessions, Classes, Students, Subjects, Teacher invites, Scores) — new "API endpoints" are just new typed functions in a `pages/<feature>/` file or, as the app grows, extracted into `src/lib/api/<feature>.ts` modules.

## Realtime (available, used selectively)
Supabase Realtime is enabled on the client (`src/lib/supabase.ts`, `realtime.params.eventsPerSecond: 10`). Planned use in later phases: a school admin watching live score-entry progress across teachers during a CA window, and instant UI updates when a super admin suspends a school mid-session.

## Offline Writes (Score Entry — Phase 2/3)
Teacher score entry doesn't call Supabase directly when offline. Instead:
1. Score write → `saveOfflineScore()` in `src/lib/idb.ts` (IndexedDB), tagged `sync_status: 'pending'`
2. `NetworkContext` detects the `online` browser event
3. A sync routine (Phase 3) reads `getPendingOfflineScores()`, replays each as a Supabase `upsert`, and calls `markScoreSynced()` or `markScoreError()` per row
4. RLS still applies during sync — a score for a now-locked term is rejected by Postgres even though it was accepted locally, and surfaces as a sync error in the UI

## Edge Functions (planned, Phase 3+)
PDF report card generation will run as a Supabase Edge Function (Deno) rather than client-side, to keep the rendering library out of the PWA bundle and to allow generating reports server-side for bulk export. Not implemented in Phase 1.

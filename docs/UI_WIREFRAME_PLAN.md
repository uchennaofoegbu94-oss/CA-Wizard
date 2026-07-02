# CA-Wizard — UI Wireframe Plan

## Navigation Shell
Persistent collapsible sidebar (dark `brand-900` theme) + top bar with online/offline indicator. Role determines which nav items render (`AppShell.tsx`). Mobile: sidebar becomes an off-canvas drawer triggered by a hamburger icon.

## Screen Inventory by Role

### Super Admin
| Screen | Route | Status | Purpose |
|---|---|---|---|
| Dashboard | `/super-admin` | ✅ Phase 1 | Platform-wide stats: school count, user count, recent schools |
| Schools | `/super-admin/schools` | ✅ Phase 1 | Full CRUD table: create, edit, suspend/activate, delete |
| Users | `/super-admin/users` | Phase 2 | Cross-tenant user search and management |
| Audit Logs | `/super-admin/audit` | Phase 2 | Platform-wide activity feed |
| Settings | `/super-admin/settings` | Phase 2 | Platform configuration, subscription tier limits |

### School Admin
| Screen | Route | Status | Purpose |
|---|---|---|---|
| Dashboard | `/school` | ✅ Phase 1 | School stats, current session/term banner, quick actions |
| Sessions | `/school/sessions` | Phase 2 | Create sessions, manage terms (publish/lock) |
| Classes | `/school/classes` | Phase 2 | Create class levels, arms, assign form teachers |
| Students | `/school/students` | Phase 2 | Student roster CRUD, bulk import, enrollment |
| Subjects | `/school/subjects` | Phase 2 | Subject catalogue per class level |
| Teachers | `/school/teachers` | Phase 2 | Generate invite codes, view/revoke teacher assignments |
| Assessments | `/school/assessments` | Phase 2 | CA category configuration (Classwork, Quiz, etc.) + max scores |
| Grading | `/school/grading` | Phase 2 | Grade boundary editor (A/B/C… + remarks) |
| Reports | `/school/reports` | Phase 3 | Broadsheet view, bulk report card generation, PDF export |
| Settings | `/school/settings` | Phase 2 | School profile, logo upload, subscription |

### Teacher
| Screen | Route | Status | Purpose |
|---|---|---|---|
| Dashboard | `/teacher` | ✅ Phase 1 | Assignment list, current term status, offline/sync banner |
| My Classes | `/teacher/classes` | Phase 2 | List of assigned classes with student rosters |
| Score Entry | `/teacher/scores` | Phase 2 | Spreadsheet-style grid: students × CA categories, offline-capable |
| Broadsheet | `/teacher/broadsheet` | Phase 2 | Read-only CA broadsheet for assigned classes |

### Auth (Public)
| Screen | Route | Status | Purpose |
|---|---|---|---|
| Login | `/auth/login` | ✅ Phase 1 | Email/password sign-in, role-based redirect |
| Join via Invite | `/auth/join` | ✅ Phase 1 | Code verification → school preview → account creation |

## Score Entry Grid (Phase 2 detail — designed now, built next)
The teacher score-entry screen is the most interaction-heavy surface in the app:
- Sticky left column: student photo + name + admission number
- Horizontally scrollable columns: one per active assessment category (Classwork/Homework/Quiz/Assignment), each capped at its configured `max_score`
- Inline numeric inputs with `clampScore()` validation as the student types
- Auto-save per cell after a short debounce: if online, writes to Supabase; if offline, writes to IndexedDB (`saveOfflineScore`) and queues a `SyncQueueItem`
- A floating "X pending sync" pill (already present in `AppShell`) reflects `pendingSyncCount` from `NetworkContext`
- Row-level total column (live `ca_total`) computed client-side as a preview of `v_ca_broadsheet`

## Report Card Layout (Phase 3 detail)
A4 print-optimized layout using the `print-only` / `no-print` CSS utility classes already defined in `index.css`: school header with logo/motto, student bio block, subject score table (CA/Exam/Total/Grade/Remark), affective + psychomotor rating grids, attendance summary, teacher/management comments, signature blocks. Rendered to PDF via a Phase 3 library (e.g. `@react-pdf/renderer` or server-side Puppeteer in a Supabase Edge Function) from the immutable `report_snapshots.snapshot_data` JSON — never recomputed live, to preserve historical accuracy.

## Design System Notes
- Color: `brand` scale (blue, `#1e3a8a` → `#eff6ff`) as primary; status colors (green/red/yellow/blue) for badges via shadcn `Badge` variants already implemented
- Components: shadcn/ui primitives wired directly (`button`, `input`, `select`, `dialog`, `alert-dialog`, `table`, `badge`, `avatar`, `dropdown-menu`) — no external UI kit
- Empty/loading states standardized via `EmptyState`, `Skeleton`, `Spinner` in `components/ui/table.tsx`
- All admin CRUD screens follow the same pattern established in `SchoolsPage.tsx`: search bar → table → dialog form → alert-dialog delete confirmation. Phase 2 screens (Sessions, Classes, Students, etc.) will reuse this exact pattern for consistency and faster build velocity.

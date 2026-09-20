import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { Toaster } from 'react-hot-toast'

import { AuthProvider } from '@/contexts/AuthContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { NetworkProvider } from '@/contexts/NetworkContext'
import { RequireAuth, RequireGuest } from '@/components/layout/RequireAuth'
import { RequireActiveSchool } from '@/components/layout/RequireActiveSchool'
import { AppShell } from '@/components/layout/AppShell'

// ── Auth ────────────────────────────────────────────────────
import LandingPage from '@/pages/marketing/LandingPage'
import DocumentationPage from '@/pages/marketing/DocumentationPage'
import TermsPage from '@/pages/marketing/TermsPage'
import BlogPage from '@/pages/marketing/BlogPage'
import BlogPostPage from '@/pages/marketing/BlogPostPage'
import AboutPage from '@/pages/marketing/AboutPage'
import WorkWithUsPage from '@/pages/marketing/WorkWithUsPage'
import LoginPage from '@/pages/auth/LoginPage'
import ForgotPasswordPage from '@/pages/auth/ForgotPasswordPage'
import ResetPasswordPage from '@/pages/auth/ResetPasswordPage'
import JoinPage  from '@/pages/auth/JoinPage'
import RegisterSchoolPage from '@/pages/auth/RegisterSchoolPage'

// ── Super Admin ─────────────────────────────────────────────
import SuperAdminDashboard from '@/pages/super-admin/DashboardPage'
import SchoolsPage         from '@/pages/super-admin/SchoolsPage'
import GroupsPage          from '@/pages/super-admin/GroupsPage'
import BlogPostsPage       from '@/pages/super-admin/BlogPostsPage'
import CompanyContentPage  from '@/pages/super-admin/CompanyContentPage'

// ── School Admin ────────────────────────────────────────────
import SchoolAdminDashboard from '@/pages/school-admin/DashboardPage'
import SessionsPage         from '@/pages/school-admin/SessionsPage'
import ClassesPage          from '@/pages/school-admin/ClassesPage'
import ClassDetailPage      from '@/pages/school-admin/ClassDetailPage'
import StudentsPage         from '@/pages/school-admin/StudentsPage'
import SubjectsPage         from '@/pages/school-admin/SubjectsPage'
import TeachersPage         from '@/pages/school-admin/TeachersPage'
import SectionAdminsPage    from '@/pages/school-admin/SectionAdminsPage'
import AssessmentsPage      from '@/pages/school-admin/AssessmentsPage'
import GradingPage          from '@/pages/school-admin/GradingPage'
import SettingsPage         from '@/pages/school-admin/SettingsPage'
import SuperAdminSettingsPage from '@/pages/super-admin/SuperAdminSettingsPage'
import SuperAdminAnalyticsPage from '@/pages/super-admin/SuperAdminAnalyticsPage'
import SchoolAdminAnalyticsPage from '@/pages/school-admin/SchoolAdminAnalyticsPage'
import PromotionPage        from '@/pages/school-admin/PromotionPage'
import TranscriptPage       from '@/pages/school-admin/TranscriptPage'
import DomainsPage          from '@/pages/school-admin/DomainsPage'
import TermRecordsPage      from '@/pages/shared/TermRecordsPage'

// ── Teacher ─────────────────────────────────────────────────
import TeacherDashboard    from '@/pages/teacher/DashboardPage'
import TeacherClassesPage  from '@/pages/teacher/ClassesPage'
import SectionAdminPage    from '@/pages/teacher/SectionAdminPage'

// ── Group Admin / Shared ─────────────────────────────────────
import GroupAdminHomePage  from '@/pages/shared/GroupAdminHomePage'
import SupportTicketsPage  from '@/pages/shared/SupportTicketsPage'
import AnnouncementsPage   from '@/pages/shared/AnnouncementsPage'

// ── Phase 3 stubs ───────────────────────────────────────────
import UsersPage from '@/pages/super-admin/UsersPage'
import AuditPage from '@/pages/super-admin/AuditPage'
import ReportsPage from '@/pages/school-admin/ReportsPage'
import ReportCardPage from '@/pages/school-admin/ReportCardPage'
import BulkReportCardPage from '@/pages/school-admin/BulkReportCardPage'
import BulkTranscriptPage from '@/pages/school-admin/BulkTranscriptPage'
import ProfilePage from '@/pages/ProfilePage'
import ScoreEntryPage from '@/pages/teacher/ScoreEntryPage'
import BroadsheetPage from '@/pages/teacher/BroadsheetPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2,
      gcTime:    1000 * 60 * 10,
      retry: 2,
      // Was `true` — every query on every page refetched the instant the
      // browser tab regained focus, which is what made switching to
      // another tab "for just a second" and back feel like the whole
      // app reloaded. This is a data-entry app where changes already
      // invalidate the right queries themselves (every mutation here
      // calls invalidateQueries on success) — a background refetch
      // triggered purely by tab-focus isn't buying anything for that,
      // and for at least one page (Score Entry) it was actively part of
      // what made in-progress, not-yet-saved edits look like they'd
      // vanished. refetchOnReconnect stays on (actually coming back
      // online after a real network drop is worth refetching for).
      refetchOnWindowFocus: false
    }
  }
})

function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <NetworkProvider>
            <BrowserRouter>
              <Routes>
              {/* ── Public ──────────────────────────────────── */}
              <Route element={<RequireGuest />}>
                <Route path="/" element={<LandingPage />} />
                <Route path="/auth/login" element={<LoginPage />} />
                <Route path="/auth/join"  element={<JoinPage />} />
                <Route path="/auth/register-school" element={<RegisterSchoolPage />} />
                <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
              </Route>

              {/* Accessible regardless of auth state — unlike the guest-only
                  group above, a logged-in admin might still want to read these.
                  reset-password lives here too, deliberately NOT under
                  RequireGuest: following the emailed link signs the browser
                  into a temporary recovery session, and RequireGuest would
                  redirect that straight to the dashboard before the person
                  can set a new password. See the page's own comment. */}
              <Route path="/auth/reset-password" element={<ResetPasswordPage />} />
              <Route path="/docs" element={<DocumentationPage />} />
              <Route path="/terms" element={<TermsPage />} />
              <Route path="/blog" element={<BlogPage />} />
              <Route path="/blog/:slug" element={<BlogPostPage />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="/work-with-us" element={<WorkWithUsPage />} />

              {/* ── Super Admin ─────────────────────────────── */}
              <Route element={<RequireAuth allowedRoles={['super_admin']} />}>
                <Route path="/super-admin"          element={<AppShell><SuperAdminDashboard /></AppShell>} />
                <Route path="/super-admin/schools"  element={<AppShell><SchoolsPage /></AppShell>} />
                <Route path="/super-admin/groups"   element={<AppShell><GroupsPage /></AppShell>} />
                <Route path="/super-admin/users"    element={<AppShell><UsersPage /></AppShell>} />
                <Route path="/super-admin/tickets"  element={<AppShell><SupportTicketsPage /></AppShell>} />
                <Route path="/super-admin/announcements" element={<AppShell><AnnouncementsPage /></AppShell>} />
                <Route path="/super-admin/blog"     element={<AppShell><BlogPostsPage /></AppShell>} />
                <Route path="/super-admin/company-content" element={<AppShell><CompanyContentPage /></AppShell>} />
                <Route path="/super-admin/audit"    element={<AppShell><AuditPage /></AppShell>} />
                <Route path="/super-admin/settings" element={<AppShell><SuperAdminSettingsPage /></AppShell>} />
                <Route path="/super-admin/analytics" element={<AppShell><SuperAdminAnalyticsPage /></AppShell>} />
              </Route>

              {/* ── Group Admin ──────────────────────────────── */}
              <Route element={<RequireAuth allowedRoles={['group_admin']} />}>
                <Route path="/group-admin"          element={<AppShell><GroupAdminHomePage /></AppShell>} />
                <Route path="/group-admin/tickets"  element={<AppShell><SupportTicketsPage /></AppShell>} />
                <Route path="/group-admin/announcements" element={<AppShell><AnnouncementsPage /></AppShell>} />
              </Route>

              {/* ── School Admin ─────────────────────────────── */}
              <Route element={<RequireAuth allowedRoles={['school_admin']} />}>
                <Route element={<RequireActiveSchool />}>
                  <Route path="/school"             element={<AppShell><SchoolAdminDashboard /></AppShell>} />
                  <Route path="/school/sessions"    element={<AppShell><SessionsPage /></AppShell>} />
                  <Route path="/school/classes"     element={<AppShell><ClassesPage /></AppShell>} />
                  <Route path="/school/classes/:id" element={<AppShell><ClassDetailPage /></AppShell>} />
                  <Route path="/school/students"    element={<AppShell><StudentsPage /></AppShell>} />
                  <Route path="/school/subjects"    element={<AppShell><SubjectsPage /></AppShell>} />
                  <Route path="/school/teachers"    element={<AppShell><TeachersPage /></AppShell>} />
                  <Route path="/school/section-admins" element={<AppShell><SectionAdminsPage /></AppShell>} />
                  <Route path="/school/assessments" element={<AppShell><AssessmentsPage /></AppShell>} />
                  <Route path="/school/grading"     element={<AppShell><GradingPage /></AppShell>} />
                  <Route path="/school/promotion"   element={<AppShell><PromotionPage /></AppShell>} />
                  <Route path="/school/transcript"  element={<AppShell><TranscriptPage /></AppShell>} />
                  <Route path="/school/reports"     element={<AppShell><ReportsPage /></AppShell>} />
                  <Route path="/school/analytics"   element={<AppShell><SchoolAdminAnalyticsPage /></AppShell>} />
                  <Route path="/school/reports/report-card" element={<AppShell><ReportCardPage /></AppShell>} />
                  <Route path="/school/reports/bulk-report-cards" element={<AppShell><BulkReportCardPage /></AppShell>} />
                  <Route path="/school/reports/bulk-transcripts" element={<AppShell><BulkTranscriptPage /></AppShell>} />
                  <Route path="/school/settings"    element={<AppShell><SettingsPage /></AppShell>} />
                  <Route path="/school/domains"     element={<AppShell><DomainsPage /></AppShell>} />
                  <Route path="/school/records"     element={<AppShell><TermRecordsPage /></AppShell>} />
                  <Route path="/school/support"     element={<AppShell><SupportTicketsPage /></AppShell>} />
                  <Route path="/school/announcements" element={<AppShell><AnnouncementsPage /></AppShell>} />
                </Route>
              </Route>

              {/* ── Teacher ──────────────────────────────────── */}
              <Route element={<RequireAuth allowedRoles={['teacher']} />}>
                <Route path="/teacher"            element={<AppShell><TeacherDashboard /></AppShell>} />
                <Route path="/teacher/classes"    element={<AppShell><TeacherClassesPage /></AppShell>} />
                <Route path="/teacher/scores"     element={<AppShell><ScoreEntryPage /></AppShell>} />
                <Route path="/teacher/broadsheet" element={<AppShell><BroadsheetPage /></AppShell>} />
                <Route path="/teacher/records"    element={<AppShell><TermRecordsPage /></AppShell>} />
                <Route path="/teacher/section-admin" element={<AppShell><SectionAdminPage /></AppShell>} />
                {/* Same components as the school-admin Reports pages
                    (imported above) — a section admin with
                    can_download_documents reaches these via their own
                    Documents tab, never via /school/reports itself
                    (which stays school_admin-only). See each page's
                    own role-aware backToReportsUrl. */}
                <Route path="/teacher/section-admin/report-card" element={<AppShell><ReportCardPage /></AppShell>} />
                <Route path="/teacher/section-admin/bulk-report-cards" element={<AppShell><BulkReportCardPage /></AppShell>} />
                <Route path="/teacher/section-admin/transcript" element={<AppShell><TranscriptPage /></AppShell>} />
                <Route path="/teacher/section-admin/bulk-transcripts" element={<AppShell><BulkTranscriptPage /></AppShell>} />
                <Route path="/teacher/support"    element={<AppShell><SupportTicketsPage /></AppShell>} />
              </Route>

              {/* ── Shared ───────────────────────────────────── */}
              <Route element={<RequireAuth />}>
                <Route path="/profile" element={<AppShell><ProfilePage /></AppShell>} />
              </Route>

              {/* ── Fallback ─────────────────────────────────── */}
              <Route path="*"  element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>

          <Toaster
            position="top-right"
            toastOptions={{
              duration: 4000,
              style: { borderRadius: '8px', fontSize: '14px' }
            }}
          />
          <ReactQueryDevtools initialIsOpen={false} />
        </NetworkProvider>
      </AuthProvider>
    </QueryClientProvider>
    </ThemeProvider>
  )
}

export default App
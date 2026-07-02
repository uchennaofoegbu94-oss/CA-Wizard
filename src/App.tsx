import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { Toaster } from 'react-hot-toast'

import { AuthProvider } from '@/contexts/AuthContext'
import { NetworkProvider } from '@/contexts/NetworkContext'
import { RequireAuth, RequireGuest } from '@/components/layout/RequireAuth'
import { AppShell } from '@/components/layout/AppShell'

// Auth pages
import LoginPage from '@/pages/auth/LoginPage'
import JoinPage from '@/pages/auth/JoinPage'

// Super Admin pages
import SuperAdminDashboard from '@/pages/super-admin/DashboardPage'
import SchoolsPage from '@/pages/super-admin/SchoolsPage'

// School Admin pages
import SchoolAdminDashboard from '@/pages/school-admin/DashboardPage'

// Teacher pages
import TeacherDashboard from '@/pages/teacher/DashboardPage'

// Placeholder pages (Phase 2+)
import {
  SessionsPage, ClassesPage, StudentsPage, SubjectsPage, TeachersPage,
  AssessmentsPage, GradingPage, ReportsPage, SettingsPage,
  ScoreEntryPage, BroadsheetPage, AuditPage, UsersPage, ProfilePage
} from '@/pages/PlaceholderPage'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2,      // 2 min
      gcTime: 1000 * 60 * 10,        // 10 min
      retry: 2,
      refetchOnWindowFocus: true
    }
  }
})

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <NetworkProvider>
          <BrowserRouter>
            <Routes>
              {/* Public routes — redirect to dashboard if logged in */}
              <Route element={<RequireGuest />}>
                <Route path="/auth/login" element={<LoginPage />} />
                <Route path="/auth/join" element={<JoinPage />} />
              </Route>

              {/* ── Super Admin ─────────────────────────────── */}
              <Route element={<RequireAuth allowedRoles={['super_admin']} />}>
                <Route path="/super-admin" element={<AppShell><SuperAdminDashboard /></AppShell>} />
                <Route path="/super-admin/schools" element={<AppShell><SchoolsPage /></AppShell>} />
                <Route path="/super-admin/users" element={<AppShell><UsersPage /></AppShell>} />
                <Route path="/super-admin/audit" element={<AppShell><AuditPage /></AppShell>} />
                <Route path="/super-admin/settings" element={<AppShell><SettingsPage /></AppShell>} />
              </Route>

              {/* ── School Admin ─────────────────────────────── */}
              <Route element={<RequireAuth allowedRoles={['school_admin']} />}>
                <Route path="/school" element={<AppShell><SchoolAdminDashboard /></AppShell>} />
                <Route path="/school/sessions" element={<AppShell><SessionsPage /></AppShell>} />
                <Route path="/school/classes" element={<AppShell><ClassesPage /></AppShell>} />
                <Route path="/school/students" element={<AppShell><StudentsPage /></AppShell>} />
                <Route path="/school/subjects" element={<AppShell><SubjectsPage /></AppShell>} />
                <Route path="/school/teachers" element={<AppShell><TeachersPage /></AppShell>} />
                <Route path="/school/assessments" element={<AppShell><AssessmentsPage /></AppShell>} />
                <Route path="/school/grading" element={<AppShell><GradingPage /></AppShell>} />
                <Route path="/school/reports" element={<AppShell><ReportsPage /></AppShell>} />
                <Route path="/school/settings" element={<AppShell><SettingsPage /></AppShell>} />
              </Route>

              {/* ── Teacher ──────────────────────────────────── */}
              <Route element={<RequireAuth allowedRoles={['teacher']} />}>
                <Route path="/teacher" element={<AppShell><TeacherDashboard /></AppShell>} />
                <Route path="/teacher/classes" element={<AppShell><ClassesPage /></AppShell>} />
                <Route path="/teacher/scores" element={<AppShell><ScoreEntryPage /></AppShell>} />
                <Route path="/teacher/broadsheet" element={<AppShell><BroadsheetPage /></AppShell>} />
              </Route>

              {/* ── Shared ───────────────────────────────────── */}
              <Route element={<RequireAuth />}>
                <Route path="/profile" element={<AppShell><ProfilePage /></AppShell>} />
              </Route>

              {/* Default redirect */}
              <Route path="/" element={<Navigate to="/auth/login" replace />} />
              <Route path="*" element={<Navigate to="/auth/login" replace />} />
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
  )
}

export default App

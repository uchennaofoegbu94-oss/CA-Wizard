import { useQuery } from '@tanstack/react-query'
import { Users, BookOpen, GraduationCap, ClipboardList, AlertCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { PageHeader, StatsCard, Skeleton } from '@/components/ui/table'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Link } from 'react-router-dom'
import type { Session, Term } from '@/types'

async function fetchSchoolDashboard(schoolId: string) {
  const [students, teachers, classes, currentSession, terms] = await Promise.all([
    supabase.from('students').select('id', { count: 'exact', head: true }).eq('school_id', schoolId).eq('is_active', true),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('school_id', schoolId).eq('role', 'teacher'),
    supabase.from('classes').select('id', { count: 'exact', head: true }).eq('school_id', schoolId),
    supabase.from('sessions').select('*').eq('school_id', schoolId).eq('is_current', true).single(),
    supabase.from('terms').select('*').eq('school_id', schoolId).order('created_at', { ascending: false }).limit(3)
  ])

  return {
    studentCount: students.count ?? 0,
    teacherCount: teachers.count ?? 0,
    classCount: classes.count ?? 0,
    currentSession: currentSession.data as Session | null,
    recentTerms: (terms.data ?? []) as Term[]
  }
}

export default function SchoolAdminDashboard() {
  const { schoolId, profile } = useAuth()
  const { data, isLoading } = useQuery({
    queryKey: ['school-dashboard', schoolId],
    queryFn: () => fetchSchoolDashboard(schoolId!),
    enabled: !!schoolId
  })

  return (
    <div>
      <PageHeader
        title={`Welcome, ${profile?.first_name}`}
        description="Here's your school's assessment overview"
      />

      {/* Setup banner if no session */}
      {!isLoading && !data?.currentSession && (
        <div className="mb-6 rounded-lg border border-orange-200 bg-orange-50 p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-orange-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-orange-900">Setup required</p>
            <p className="text-sm text-orange-700 mt-0.5">
              No active session found. Start by creating a session, then add terms, classes, and subjects.
            </p>
          </div>
          <Button size="sm" asChild>
            <Link to="/school/sessions">Set Up Now</Link>
          </Button>
        </div>
      )}

      {/* Current Session */}
      {data?.currentSession && (
        <div className="mb-6 rounded-lg border border-brand-200 bg-brand-50 p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-brand-600 font-medium uppercase tracking-wide">Current Session</p>
            <p className="text-lg font-bold text-brand-900">{data.currentSession.name}</p>
          </div>
          <div className="flex gap-2">
            {data.recentTerms.map(term => (
              <Badge key={term.id} variant={term.is_current ? 'default' : 'outline'}>
                {term.name.replace(' Term', '')}
                {term.is_locked && ' 🔒'}
                {term.is_published && ' ✓'}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-lg" />)
        ) : (
          <>
            <StatsCard title="Students" value={data?.studentCount ?? 0} subtitle="Active students" icon={<Users className="h-5 w-5" />} />
            <StatsCard title="Teachers" value={data?.teacherCount ?? 0} subtitle="Registered" icon={<Users className="h-5 w-5" />} />
            <StatsCard title="Classes" value={data?.classCount ?? 0} subtitle="This session" icon={<GraduationCap className="h-5 w-5" />} />
            <StatsCard title="Subjects" value="—" subtitle="Across all levels" icon={<BookOpen className="h-5 w-5" />} />
          </>
        )}
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Add Student',      to: '/school/students',     icon: Users },
              { label: 'Manage Classes',   to: '/school/classes',      icon: GraduationCap },
              { label: 'Invite Teacher',   to: '/school/teachers',     icon: Users },
              { label: 'View Reports',     to: '/school/reports',      icon: ClipboardList }
            ].map(action => (
              <Link
                key={action.to}
                to={action.to}
                className="flex flex-col items-center gap-2 rounded-lg border p-4 hover:bg-accent transition-colors text-center"
              >
                <action.icon className="h-6 w-6 text-brand-600" />
                <span className="text-sm font-medium">{action.label}</span>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

import { useQuery } from '@tanstack/react-query'
import { ClipboardList, GraduationCap, Wifi, WifiOff, RefreshCw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useNetwork } from '@/contexts/NetworkContext'
import { PageHeader, StatsCard, Skeleton } from '@/components/ui/table'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Link } from 'react-router-dom'
import type { TeacherAssignment, Term } from '@/types'

async function fetchTeacherDashboard(profileId: string, schoolId: string) {
  const [assignments, currentTerm] = await Promise.all([
    supabase
      .from('teacher_assignments')
      .select('*, class:classes(*, class_level:class_levels(*), class_arm:class_arms(*)), subject:subjects(*)')
      .eq('teacher_id', profileId),
    supabase
      .from('terms')
      .select('*')
      .eq('school_id', schoolId)
      .eq('is_current', true)
      .single()
  ])

  return {
    assignments: (assignments.data ?? []) as TeacherAssignment[],
    currentTerm: currentTerm.data as Term | null,
    uniqueClasses: [...new Set((assignments.data ?? []).map(a => a.class_id))].length
  }
}

export default function TeacherDashboard() {
  const { profile, schoolId } = useAuth()
  const { isOnline, pendingSyncCount } = useNetwork()

  const { data, isLoading } = useQuery({
    queryKey: ['teacher-dashboard', profile?.id],
    queryFn: () => fetchTeacherDashboard(profile!.id, schoolId!),
    enabled: !!profile?.id && !!schoolId
  })

  return (
    <div>
      <PageHeader
        title={`Hello, ${profile?.first_name}`}
        description="Your classes and score entry portal"
      />

      {/* Offline / Sync Banner */}
      {!isOnline && (
        <div className="mb-4 rounded-lg border border-orange-200 bg-orange-50 p-3 flex items-center gap-3">
          <WifiOff className="h-4 w-4 text-orange-600 shrink-0" />
          <p className="text-sm text-orange-800">
            You're offline. Scores entered now will sync automatically when you reconnect.
          </p>
        </div>
      )}

      {isOnline && pendingSyncCount > 0 && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-blue-600 animate-spin" />
            <p className="text-sm text-blue-800">{pendingSyncCount} score{pendingSyncCount !== 1 ? 's' : ''} syncing…</p>
          </div>
        </div>
      )}

      {/* Current Term */}
      {data?.currentTerm && (
        <div className="mb-4 rounded-lg border bg-card p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground uppercase font-medium tracking-wide">Active Term</p>
            <p className="font-semibold">{data.currentTerm.name}</p>
          </div>
          <div className="flex gap-2">
            {data.currentTerm.is_locked && <Badge variant="warning">Locked</Badge>}
            {data.currentTerm.is_published && <Badge variant="success">Published</Badge>}
            {!data.currentTerm.is_locked && !data.currentTerm.is_published && (
              <Badge variant="info">Open</Badge>
            )}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        {isLoading ? (
          Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-lg" />)
        ) : (
          <>
            <StatsCard
              title="My Classes"
              value={data?.uniqueClasses ?? 0}
              subtitle="Assigned this session"
              icon={<GraduationCap className="h-5 w-5" />}
            />
            <StatsCard
              title="Subjects"
              value={data?.assignments.length ?? 0}
              subtitle="To manage"
              icon={<ClipboardList className="h-5 w-5" />}
            />
          </>
        )}
      </div>

      {/* Assignments */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">My Assignments</CardTitle>
          <Button size="sm" asChild>
            <Link to="/teacher/scores">Enter Scores</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded" />)}
            </div>
          ) : data?.assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No assignments yet. Ask your school admin for an invite code.
            </p>
          ) : (
            <div className="space-y-3">
              {data?.assignments.map(a => (
                <div key={a.id} className="flex items-center justify-between rounded-lg border p-3">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-md bg-brand-100 flex items-center justify-center">
                      <GraduationCap className="h-4 w-4 text-brand-700" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">
                        {a.class?.class_level?.name} {a.class?.class_arm?.name}
                        {a.subject && ` — ${a.subject.name}`}
                      </p>
                      <p className="text-xs text-muted-foreground capitalize">{a.scope.toLowerCase()} assignment</p>
                    </div>
                  </div>
                  <Button size="sm" variant="outline" asChild>
                    <Link to={`/teacher/scores?class=${a.class_id}&subject=${a.subject_id ?? ''}`}>
                      Enter
                    </Link>
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

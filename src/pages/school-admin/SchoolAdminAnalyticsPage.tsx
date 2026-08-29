import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts'
import { Users, GraduationCap, Layers, TrendingUp } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PageHeader, Spinner, EmptyState } from '@/components/ui/table'
import type { GradeRange, Term, SchoolTermTotal } from '@/types'

const CHART_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4', '#ec4899']

export default function SchoolAdminAnalyticsPage() {
  const { schoolId } = useAuth()

  const { data: currentSession } = useQuery({
    queryKey: ['analytics-current-session', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('sessions').select('*').eq('school_id', schoolId!).eq('is_current', true).maybeSingle()
      if (error) throw error
      return data
    },
    enabled: !!schoolId
  })

  const { data: currentTerm } = useQuery({
    queryKey: ['analytics-current-term', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('terms').select('*').eq('school_id', schoolId!).eq('is_current', true).maybeSingle()
      if (error) throw error
      return data as Term | null
    },
    enabled: !!schoolId
  })

  const { data: students = [], isLoading: loadingStudents } = useQuery({
    queryKey: ['analytics-school-students', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('students').select('id, is_active, status').eq('school_id', schoolId!)
      if (error) throw error
      return data as { id: string; is_active: boolean; status: string }[]
    },
    enabled: !!schoolId
  })

  const { data: teachers = [] } = useQuery({
    queryKey: ['analytics-school-teachers', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id, is_active').eq('school_id', schoolId!).eq('role', 'teacher')
      if (error) throw error
      return data as { id: string; is_active: boolean }[]
    },
    enabled: !!schoolId
  })

  const { data: classes = [] } = useQuery({
    queryKey: ['analytics-school-classes', schoolId, currentSession?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('classes').select('id, class_level:class_levels(name)').eq('school_id', schoolId!).eq('session_id', currentSession!.id)
      if (error) throw error
      return data as unknown as { id: string; class_level: { name: string } | null }[]
    },
    enabled: !!schoolId && !!currentSession
  })

  // get_school_term_totals returns raw IDs only (student_id, class_id,
  // subject_id, percentage) — an RPC call can't do PostgREST-style
  // embedded joins the way a table select() can, so subject names are
  // fetched separately here and joined by ID client-side below. Class
  // names are already available the same way via the `classes` query
  // above.
  const { data: subjects = [] } = useQuery({
    queryKey: ['analytics-school-subjects', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('subjects').select('id, name').eq('school_id', schoolId!)
      if (error) throw error
      return data as { id: string; name: string }[]
    },
    enabled: !!schoolId
  })

  const { data: enrollments = [] } = useQuery({
    queryKey: ['analytics-school-enrollments', schoolId, currentSession?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('student_enrollments').select('class_id').eq('school_id', schoolId!).eq('session_id', currentSession!.id)
      if (error) throw error
      return data as { class_id: string }[]
    },
    enabled: !!schoolId && !!currentSession
  })

  // Replaces the old v_term_results query (that view no longer
  // exists — grading is now driven by whichever computed field a
  // school has designated as its Total). get_school_term_totals is
  // total-field-only and school-wide: one row per (student, subject)
  // with a percentage already normalized to 0–100, regardless of
  // which compute_operation the school's Total field actually uses.
  const { data: termResults = [] } = useQuery({
    queryKey: ['analytics-term-results', schoolId, currentTerm?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_school_term_totals', {
        p_school_id: schoolId!, p_term_id: currentTerm!.id
      })
      if (error) throw error
      return (data ?? []) as SchoolTermTotal[]
    },
    enabled: !!schoolId && !!currentTerm
  })

  const { data: gradeRanges = [] } = useQuery({
    queryKey: ['analytics-grade-ranges', schoolId],
    queryFn: async () => {
      const { data, error } = await supabase.from('grading_systems').select('grade_ranges(*)').eq('school_id', schoolId!).eq('is_default', true).maybeSingle()
      if (error) throw error
      return (data?.grade_ranges ?? []) as GradeRange[]
    },
    enabled: !!schoolId
  })

  const { data: attendance = [] } = useQuery({
    queryKey: ['analytics-attendance', schoolId, currentTerm?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('attendance').select('days_present, total_days').eq('school_id', schoolId!).eq('term_id', currentTerm!.id)
      if (error) throw error
      return data as { days_present: number; total_days: number }[]
    },
    enabled: !!schoolId && !!currentTerm
  })

  const { data: allTerms = [] } = useQuery({
    queryKey: ['analytics-all-terms', schoolId, currentSession?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('terms').select('*').eq('school_id', schoolId!).eq('session_id', currentSession!.id).order('name')
      if (error) throw error
      return data as Term[]
    },
    enabled: !!schoolId && !!currentSession
  })

  const activeStudents = students.filter(s => s.is_active)
  const activeTeachers = teachers.filter(t => t.is_active)
  const schoolAverage = termResults.length > 0
    ? Math.round((termResults.reduce((sum, r) => sum + r.percentage, 0) / termResults.length) * 10) / 10
    : null

  const enrollmentByClass = useMemo(() => {
    const counts: Record<string, number> = {}
    enrollments.forEach(e => { counts[e.class_id] = (counts[e.class_id] ?? 0) + 1 })
    return classes
      .map(c => ({ name: c.class_level?.name ?? 'Unknown', students: counts[c.id] ?? 0 }))
      .sort((a, b) => b.students - a.students)
  }, [classes, enrollments])

  const gradeDistribution = useMemo(() => {
    if (gradeRanges.length === 0 || termResults.length === 0) return []
    const sorted = [...gradeRanges].sort((a, b) => b.min_score - a.min_score)
    const counts: Record<string, number> = Object.fromEntries(sorted.map(r => [r.grade, 0]))
    termResults.forEach(r => {
      const match = sorted.find(g => r.percentage >= g.min_score && r.percentage <= g.max_score)
      if (match) counts[match.grade]++
    })
    return sorted.map(r => ({ name: r.grade, value: counts[r.grade] })).filter(g => g.value > 0)
  }, [gradeRanges, termResults])

  const averageBySubject = useMemo(() => {
    const bySubject: Record<string, number[]> = {}
    termResults.forEach(r => {
      const name = subjects.find(s => s.id === r.subject_id)?.name ?? 'Unknown'
      if (!bySubject[name]) bySubject[name] = []
      bySubject[name].push(r.percentage)
    })
    return Object.entries(bySubject)
      .map(([name, scores]) => ({ name, average: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 }))
      .sort((a, b) => b.average - a.average)
  }, [termResults, subjects])

  const averageByClass = useMemo(() => {
    const byClass: Record<string, number[]> = {}
    termResults.forEach(r => {
      const name = classes.find(c => c.id === r.class_id)?.class_level?.name ?? 'Unknown'
      if (!byClass[name]) byClass[name] = []
      byClass[name].push(r.percentage)
    })
    return Object.entries(byClass)
      .map(([name, scores]) => ({ name, average: Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 }))
      .sort((a, b) => b.average - a.average)
  }, [termResults, classes])

  const attendanceRate = useMemo(() => {
    if (attendance.length === 0) return null
    const totalPresent = attendance.reduce((sum, a) => sum + a.days_present, 0)
    const totalDays = attendance.reduce((sum, a) => sum + a.total_days, 0)
    return totalDays > 0 ? Math.round((totalPresent / totalDays) * 1000) / 10 : null
  }, [attendance])

  if (loadingStudents) {
    return <div className="flex justify-center py-16"><Spinner size="lg" /></div>
  }

  if (!currentSession) {
    return <EmptyState title="No current session" description="Set a current session in Sessions to see analytics." />
  }

  return (
    <div>
      <PageHeader title="Analytics" description={`${currentSession.name}${currentTerm ? ` — ${currentTerm.name}` : ' — no current term set'}`} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard icon={Users} label="Active Students" value={activeStudents.length.toString()} />
        <KpiCard icon={GraduationCap} label="Active Teachers" value={activeTeachers.length.toString()} />
        <KpiCard icon={Layers} label="Classes" value={classes.length.toString()} />
        <KpiCard
          icon={TrendingUp}
          label="School Average"
          value={schoolAverage !== null ? `${schoolAverage}` : '—'}
          sub={currentTerm ? undefined : 'No current term'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Enrollment by Class</CardTitle>
            <CardDescription>{currentSession.name}</CardDescription>
          </CardHeader>
          <CardContent>
            {enrollmentByClass.length === 0 ? (
              <EmptyState title="No classes set up yet" />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={enrollmentByClass}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="name" fontSize={11} />
                  <YAxis fontSize={11} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="students" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Grade Distribution</CardTitle>
            <CardDescription>{currentTerm ? currentTerm.name : 'No current term set'}</CardDescription>
          </CardHeader>
          <CardContent>
            {gradeDistribution.length === 0 ? (
              <EmptyState title="No scores recorded yet" description="Grade distribution appears once scores are entered for the current term." />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={gradeDistribution} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80} label={({ name, value }: { name?: string; value?: number }) => `${name}: ${value}`}>
                    {gradeDistribution.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Average Score by Subject</CardTitle>
            <CardDescription>{currentTerm ? currentTerm.name : 'No current term set'}</CardDescription>
          </CardHeader>
          <CardContent>
            {averageBySubject.length === 0 ? (
              <EmptyState title="No scores recorded yet" />
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(200, averageBySubject.length * 32)}>
                <BarChart data={averageBySubject} layout="vertical" margin={{ left: 8 }}>
                  <XAxis type="number" domain={[0, 100]} fontSize={11} />
                  <YAxis type="category" dataKey="name" fontSize={10} width={90} />
                  <Tooltip />
                  <Bar dataKey="average" fill="#22c55e" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Average Score by Class</CardTitle>
            <CardDescription>{currentTerm ? currentTerm.name : 'No current term set'}</CardDescription>
          </CardHeader>
          <CardContent>
            {averageByClass.length === 0 ? (
              <EmptyState title="No scores recorded yet" />
            ) : (
              <ResponsiveContainer width="100%" height={Math.max(200, averageByClass.length * 32)}>
                <BarChart data={averageByClass} layout="vertical" margin={{ left: 8 }}>
                  <XAxis type="number" domain={[0, 100]} fontSize={11} />
                  <YAxis type="category" dataKey="name" fontSize={10} width={90} />
                  <Tooltip />
                  <Bar dataKey="average" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Attendance Rate</CardTitle>
            <CardDescription>{currentTerm ? currentTerm.name : 'No current term set'}</CardDescription>
          </CardHeader>
          <CardContent>
            {attendanceRate === null ? (
              <EmptyState title="No attendance recorded yet" />
            ) : (
              <div className="flex items-center justify-center py-6">
                <div className="text-center">
                  <p className="text-4xl font-bold text-primary">{attendanceRate}%</p>
                  <p className="text-sm text-muted-foreground mt-1">school-wide average, {currentTerm?.name}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Term Status</CardTitle>
            <CardDescription>{currentSession.name}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {allTerms.length === 0 ? (
              <EmptyState title="No terms set up" />
            ) : (
              allTerms.map(t => (
                <div key={t.id} className="flex items-center justify-between text-sm py-1.5 border-b last:border-0">
                  <span className={t.is_current ? 'font-semibold' : ''}>{t.name}{t.is_current && ' (current)'}</span>
                  <div className="flex gap-1.5">
                    <Badge variant={t.is_locked ? 'destructive' : 'outline'} className="text-[10px]">{t.is_locked ? 'Locked' : 'Open'}</Badge>
                    <Badge variant={t.is_published ? 'success' : 'outline'} className="text-[10px]">{t.is_published ? 'Published' : 'Unpublished'}</Badge>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function KpiCard({ icon: Icon, label, value, sub }: { icon: typeof Users; label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-2xl font-bold leading-none truncate">{value}</p>
            <p className="text-xs text-muted-foreground mt-1">{label}</p>
          </div>
        </div>
        {sub && <p className="text-[11px] text-muted-foreground mt-2">{sub}</p>}
      </CardContent>
    </Card>
  )
}

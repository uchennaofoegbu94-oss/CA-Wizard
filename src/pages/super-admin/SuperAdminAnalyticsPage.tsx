import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts'
import { School, Users, GraduationCap, TrendingUp } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { PageHeader, Spinner, EmptyState } from '@/components/ui/table'
import { tierLabel } from '@/lib/tierLimits'

// Monthly price points from the landing page pricing section (-50%
// pricing already applied there). Used only to compute an ESTIMATED
// MRR — there's no real billing/payment system yet, so this is
// "active schools on this tier × its list price," not actual revenue.
const TIER_MONTHLY_NGN: Record<string, number> = {
  starter: 1500,
  professional: 4849.5
  // enterprise is quote-based (Contact Sales) — deliberately excluded
  // from the estimate rather than guessed at
}

const CHART_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#06b6d4']

function monthKey(date: string) {
  const d = new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function lastNMonths(n: number): string[] {
  const months: string[] = []
  const now = new Date()
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return months
}

function monthLabel(key: string) {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-NG', { month: 'short', year: '2-digit' })
}

export default function SuperAdminAnalyticsPage() {
  const { data: schools = [], isLoading: loadingSchools } = useQuery({
    queryKey: ['analytics-schools'],
    queryFn: async () => {
      const { data, error } = await supabase.from('schools').select('id, name, status, subscription_tier, created_at')
      if (error) throw error
      return data as { id: string; name: string; status: string; subscription_tier: string; created_at: string }[]
    }
  })

  const { data: students = [], isLoading: loadingStudents } = useQuery({
    queryKey: ['analytics-students'],
    queryFn: async () => {
      const { data, error } = await supabase.from('students').select('id, school_id, is_active, created_at')
      if (error) throw error
      return data as { id: string; school_id: string; is_active: boolean; created_at: string }[]
    }
  })

  const { data: teachers = [], isLoading: loadingTeachers } = useQuery({
    queryKey: ['analytics-teachers'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id, is_active').eq('role', 'teacher')
      if (error) throw error
      return data as { id: string; is_active: boolean }[]
    }
  })

  const { data: recentAudit = [] } = useQuery({
    queryKey: ['analytics-audit-volume'],
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      const { data, error } = await supabase.from('audit_logs').select('created_at').gte('created_at', since)
      if (error) throw error
      return data as { created_at: string }[]
    }
  })

  const isLoading = loadingSchools || loadingStudents || loadingTeachers

  const activeSchools = schools.filter(s => s.status === 'active')
  const activeStudents = students.filter(s => s.is_active)
  const activeTeachers = teachers.filter(t => t.is_active)

  const estimatedMRR = useMemo(() => {
    return activeSchools.reduce((sum, s) => sum + (TIER_MONTHLY_NGN[s.subscription_tier] ?? 0), 0)
  }, [activeSchools])

  const tierBreakdown = useMemo(() => {
    const counts: Record<string, number> = {}
    schools.forEach(s => { counts[s.subscription_tier] = (counts[s.subscription_tier] ?? 0) + 1 })
    return Object.entries(counts).map(([tier, count]) => ({ name: tierLabel(tier), value: count }))
  }, [schools])

  const statusBreakdown = useMemo(() => {
    const counts: Record<string, number> = {}
    schools.forEach(s => { counts[s.status] = (counts[s.status] ?? 0) + 1 })
    return Object.entries(counts).map(([status, count]) => ({ name: status, value: count }))
  }, [schools])

  const schoolGrowth = useMemo(() => {
    const months = lastNMonths(12)
    const counts: Record<string, number> = Object.fromEntries(months.map(m => [m, 0]))
    schools.forEach(s => {
      const k = monthKey(s.created_at)
      if (k in counts) counts[k]++
    })
    return months.map(m => ({ month: monthLabel(m), schools: counts[m] }))
  }, [schools])

  const studentGrowth = useMemo(() => {
    const months = lastNMonths(12)
    const counts: Record<string, number> = Object.fromEntries(months.map(m => [m, 0]))
    students.forEach(s => {
      const k = monthKey(s.created_at)
      if (k in counts) counts[k]++
    })
    return months.map(m => ({ month: monthLabel(m), students: counts[m] }))
  }, [students])

  const topSchools = useMemo(() => {
    const counts: Record<string, number> = {}
    activeStudents.forEach(s => { counts[s.school_id] = (counts[s.school_id] ?? 0) + 1 })
    return Object.entries(counts)
      .map(([schoolId, count]) => ({ name: schools.find(s => s.id === schoolId)?.name ?? 'Unknown', students: count }))
      .sort((a, b) => b.students - a.students)
      .slice(0, 10)
  }, [activeStudents, schools])

  const activityByDay = useMemo(() => {
    const days: string[] = []
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
      days.push(d.toISOString().slice(0, 10))
    }
    const counts: Record<string, number> = Object.fromEntries(days.map(d => [d, 0]))
    recentAudit.forEach(a => {
      const d = a.created_at.slice(0, 10)
      if (d in counts) counts[d]++
    })
    return days.map(d => ({ date: d.slice(5), actions: counts[d] }))
  }, [recentAudit])

  if (isLoading) {
    return <div className="flex justify-center py-16"><Spinner size="lg" /></div>
  }

  return (
    <div>
      <PageHeader title="Platform Analytics" description="Complete, platform-wide metrics across every school" />

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard icon={School} label="Active Schools" value={activeSchools.length.toString()} sub={`${schools.length} total (all statuses)`} />
        <KpiCard icon={Users} label="Active Students" value={activeStudents.length.toLocaleString()} sub="Across all schools" />
        <KpiCard icon={GraduationCap} label="Active Teachers" value={activeTeachers.length.toLocaleString()} sub="Across all schools" />
        <KpiCard
          icon={TrendingUp}
          label="Estimated MRR"
          value={`₦${estimatedMRR.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          sub="Estimate only — no billing system yet"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">School Growth</CardTitle>
            <CardDescription>New school registrations, last 12 months</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={schoolGrowth}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="month" fontSize={11} />
                <YAxis fontSize={11} allowDecimals={false} />
                <Tooltip />
                <Line type="monotone" dataKey="schools" stroke="#3b82f6" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Student Growth</CardTitle>
            <CardDescription>New student records, last 12 months</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={studentGrowth}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="month" fontSize={11} />
                <YAxis fontSize={11} allowDecimals={false} />
                <Tooltip />
                <Line type="monotone" dataKey="students" stroke="#22c55e" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Schools by Plan</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={tierBreakdown} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75}>
                  {tierBreakdown.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Schools by Status</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={statusBreakdown} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75}>
                  {statusBreakdown.map((_, i) => <Cell key={i} fill={CHART_COLORS[(i + 2) % CHART_COLORS.length]} />)}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top Schools by Students</CardTitle>
          </CardHeader>
          <CardContent>
            {topSchools.length === 0 ? (
              <EmptyState title="No students yet" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={topSchools} layout="vertical" margin={{ left: 8 }}>
                  <XAxis type="number" fontSize={11} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" fontSize={10} width={90} tickFormatter={(v: string) => v.length > 14 ? v.slice(0, 14) + '…' : v} />
                  <Tooltip />
                  <Bar dataKey="students" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Platform Activity</CardTitle>
          <CardDescription>Audit log actions per day, last 30 days</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={activityByDay}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="date" fontSize={10} interval={2} />
              <YAxis fontSize={11} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="actions" fill="#a855f7" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  )
}

function KpiCard({ icon: Icon, label, value, sub }: { icon: typeof School; label: string; value: string; sub: string }) {
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
        <p className="text-[11px] text-muted-foreground mt-2">{sub}</p>
      </CardContent>
    </Card>
  )
}

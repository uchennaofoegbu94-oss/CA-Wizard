import { useQuery } from '@tanstack/react-query'
import { School, Users, Activity, TrendingUp } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { PageHeader, StatsCard, Skeleton } from '@/components/ui/table'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/utils'
import type { School as SchoolType } from '@/types'

async function fetchDashboardStats() {
  const [schools, profiles] = await Promise.all([
    supabase.from('schools').select('id, name, status, created_at, subscription_tier').order('created_at', { ascending: false }),
    supabase.from('profiles').select('id, role, school_id')
  ])
  return {
    schools: (schools.data ?? []) as SchoolType[],
    totalSchools: schools.data?.length ?? 0,
    activeSchools: schools.data?.filter(s => s.status === 'active').length ?? 0,
    suspendedSchools: schools.data?.filter(s => s.status === 'suspended').length ?? 0,
    totalUsers: profiles.data?.length ?? 0,
    totalTeachers: profiles.data?.filter(p => p.role === 'teacher').length ?? 0,
    recentSchools: (schools.data ?? []).slice(0, 5) as SchoolType[]
  }
}

export default function SuperAdminDashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ['super-admin-dashboard'],
    queryFn: fetchDashboardStats
  })

  return (
    <div>
      <PageHeader
        title="Platform Overview"
        description="Monitor all schools and platform activity"
      />

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-lg" />
          ))
        ) : (
          <>
            <StatsCard
              title="Total Schools"
              value={data?.totalSchools ?? 0}
              subtitle="All tenants"
              icon={<School className="h-5 w-5" />}
            />
            <StatsCard
              title="Active Schools"
              value={data?.activeSchools ?? 0}
              subtitle="Operational"
              icon={<Activity className="h-5 w-5" />}
            />
            <StatsCard
              title="Total Users"
              value={data?.totalUsers ?? 0}
              subtitle="Across all schools"
              icon={<Users className="h-5 w-5" />}
            />
            <StatsCard
              title="Teachers"
              value={data?.totalTeachers ?? 0}
              subtitle="Active teachers"
              icon={<TrendingUp className="h-5 w-5" />}
            />
          </>
        )}
      </div>

      {/* Recent Schools */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recently Added Schools</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 rounded" />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {data?.recentSchools.map(school => (
                <div key={school.id} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-md bg-brand-100 flex items-center justify-center">
                      <School className="h-4 w-4 text-brand-700" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{school.name}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(school.created_at)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={
                      school.status === 'active' ? 'success' :
                      school.status === 'suspended' ? 'destructive' : 'warning'
                    }>
                      {school.status}
                    </Badge>
                    <Badge variant="outline" className="text-xs capitalize">
                      {school.subscription_tier}
                    </Badge>
                  </div>
                </div>
              ))}
              {data?.recentSchools.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No schools yet. Create your first school.
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
